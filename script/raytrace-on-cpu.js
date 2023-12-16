
import { clamp } from 'script/maths.js'
import { mergeGeometry, calculateTangents } from 'script/geometry.js'
import { buildBLAS, trace, volume, RAY_ABCI, RAY_DISTANCE, RAY_SCORE, RAY_UVW } from 'script/rtas.js'
import { finishTexture } from 'script/utils.js'

function raytraceOnCPU(w, h, src, dst, materials, thisSession, startTime, lastTime) {
	
	const isNormalMap = !!layer.isNormalMap
	
	// build acceleration structure :)
	// for simplicity, concat all src models into one
	srcGeoData = mergeGeometry(src,srcGeoData,materials,isNormalMap,false,false)
	if(!srcGeoData) {
		srcGeoData = {}
		alert('Destination mesh needs UVs!')
		return;
	}
	
	const POSs = window.POSs = srcGeoData.POSs
	const NORs = srcGeoData.NORs
	const UVSs = srcGeoData.UVSs
	const TANs = srcGeoData.TANs
	const MATs = srcGeoData.MATs
	const IDXs = srcGeoData.IDXs
	
	console.log(-lastTime+(lastTime=Date.now()), 'merging geometry + tangents')
	
	const blas = window.blas = window.blas || buildBLAS(POSs,IDXs)
	const root = blas[0]
	const bounds = root[0]
	const tris = blas[1]
	
	console.log(-lastTime+(lastTime=Date.now()), 'building BLAS')
	
	const maxDelta = 0.25 * Math.pow(volume(bounds), 1/3)
	
	// rasterize all destination triangles
	const s4 = w*h*4
	const image = new Uint8ClampedArray(s4)
	const ray = new Float64Array(16);
	
	let dstGeoIdx = 0
	let dstTriIdx = -1
	let TANd = null
	
	// for spreading the data
	let image0 = image
	let image1 = new Uint8ClampedArray(s4)
	// for applying the sRGB transform before displaying
	const image2 = layer.sRGB ? new Uint8ClampedArray(s4) : null
	
	function raytraceData() {
		if(session != thisSession) return;
		let t0 = Date.now()
		for(;dstGeoIdx<dst.length;dstGeoIdx++){
			
			const dstI = dst[dstGeoIdx]
			const TRANSd = dstI[0].elements
			const GEOd = dstI[1]
			
			let POSd = GEOd.attributes.position
			let NORd = GEOd.attributes.normal
			let UVSd = GEOd.attributes.uv
			if(!POSd || !NORd || !UVSd) continue
			
			const index = GEOd.index
			
			// multiple uv sets are possible...
			POSd = POSd.array
			NORd = NORd.array
			UVSd = UVSd.array
			const ia = index && index.array
			const ic0 = index ? GEOd.drawRange.start : 0
			const ic1 = index ? Math.min(Math.min(index.count, ia.length), ic0 + GEOd.drawRange.count) : POSd.length/3
			
			if(dstTriIdx < 0) {
				// we're just starting this shape :)
				dstTriIdx = ic0;
				TANd = calculateTangents(POSd,NORd,UVSd,ia,ic0,ic1);
			}
			
			for(;dstTriIdx<ic1;){
				// if(dstTriIdx%1 == 0) console.log((dstTriIdx-ic0)/3,'/',(ic1-ic0)/3)
				
				// vertex indices
				const i = dstTriIdx
				const ai1d = ia ? ia[i  ] : i
				const bi1d = ia ? ia[i+1] : i+1
				const ci1d = ia ? ia[i+2] : i+2
				
				const ai2d = ai1d + ai1d
				const bi2d = bi1d + bi1d
				const ci2d = ci1d + ci1d
				
				// sector, integers
				const us = Math.floor((UVSd[ai2d  ]+UVSd[bi2d  ]+UVSd[ci2d  ])/3)
				const vs = Math.floor((UVSd[ai2d+1]+UVSd[bi2d+1]+UVSd[ci2d+1])/3)
				
				const ax = (UVSd[ai2d  ]-us) * w - 0.5
				const ay = (UVSd[ai2d+1]-vs) * h - 0.5
				const bx = (UVSd[bi2d  ]-us) * w - 0.5
				const by = (UVSd[bi2d+1]-vs) * h - 0.5
				const cx = (UVSd[ci2d  ]-us) * w - 0.5
				const cy = (UVSd[ci2d+1]-vs) * h - 0.5
				
				// console.log(u0,v0,ax,ay,bx,by,cx,cy)
				
				const xmin = Math.max(0,  Math.floor(Math.min(ax,bx,cx)))
				const ymin = Math.max(0,  Math.floor(Math.min(ay,by,cy)))
				const xmax = Math.min(w-1,Math.ceil( Math.max(ax,bx,cx)))
				const ymax = Math.min(h-1,Math.ceil( Math.max(ay,by,cy)))
				
				function det(x0,y0,x1,y1){
					return x0*y1-x1*y0
				}
				
				const ai3d = ai2d+ai1d
				const bi3d = bi2d+bi1d
				const ci3d = ci2d+ci1d
				
				for(let y=ymin;y<=ymax;y++) {
					let q = (xmin+(h-1-y)*w)<<2
					for(let x=xmin;x<=xmax;x++) {
						if(!image[q+3]){
							let wad = det(cx-bx,cy-by,x-bx,y-by) // bc -> a
							let wbd = det(ax-cx,ay-cy,x-cx,y-cy) // ac -> b
							let wcd = det(bx-ax,by-ay,x-ax,y-ay) // ab -> c
							const sum = (wad>=0.0?1:0) + (wbd>=0.0?1:0) + (wcd>=0.0?1:0)
							if(sum == 0 || sum == 3) {
								
								// find position and normal [dst]
								const iw = 1.0 / (wad+wbd+wcd)
								wad *= iw
								wbd *= iw
								wcd *= iw
								
								// destination position and normal in [dst object space]
								let px0 = POSd[ai3d  ]*wad + POSd[bi3d  ]*wbd + POSd[ci3d  ]*wcd
								let py0 = POSd[ai3d+1]*wad + POSd[bi3d+1]*wbd + POSd[ci3d+1]*wcd
								let pz0 = POSd[ai3d+2]*wad + POSd[bi3d+2]*wbd + POSd[ci3d+2]*wcd
								let nx0 = NORd[ai3d  ]*wad + NORd[bi3d  ]*wbd + NORd[ci3d  ]*wcd
								let ny0 = NORd[ai3d+1]*wad + NORd[bi3d+1]*wbd + NORd[ci3d+1]*wcd
								let nz0 = NORd[ai3d+2]*wad + NORd[bi3d+2]*wbd + NORd[ci3d+2]*wcd
								let nl0 = 1.0/Math.sqrt(nx0*nx0+ny0*ny0+nz0*nz0)
								nx0 *= nl0; ny0 *= nl0; nz0 *= nl0;
								
								// destination position and normal in [world space]
								// todo: transform could be moved before rasterization for small performance boost
								let px = px0*TRANSd[0] + py0*TRANSd[4] + pz0*TRANSd[ 8] + TRANSd[12]
								let py = px0*TRANSd[1] + py0*TRANSd[5] + pz0*TRANSd[ 9] + TRANSd[13]
								let pz = px0*TRANSd[2] + py0*TRANSd[6] + pz0*TRANSd[10] + TRANSd[14]
								let nx = nx0*TRANSd[0] + ny0*TRANSd[4] + nz0*TRANSd[ 8]
								let ny = nx0*TRANSd[1] + ny0*TRANSd[5] + nz0*TRANSd[ 9]
								let nz = nx0*TRANSd[2] + ny0*TRANSd[6] + nz0*TRANSd[10]
								
								// prepare raytracing
								ray[0] = px; ray[1] = py; ray[2] = pz
								let nl = 1.0/Math.sqrt(nx*nx+ny*ny+nz*nz)
								nx *= nl; ny *= nl; nz *= nl;
								ray[3] = nx; ray[4] = ny; ray[5] = nz
								ray[6] = clamp(1.0/ray[3], -1e38, 1e38)
								ray[7] = clamp(1.0/ray[4], -1e38, 1e38)
								ray[8] = clamp(1.0/ray[5], -1e38, 1e38)
								ray[RAY_SCORE] = maxDelta
								
								// raytrace
								window.printTrace = false // x == 4 && y == 0
								trace(tris,root,ray)
								
								const dist = ray[RAY_SCORE]
								const hit = dist < maxDelta
								if(printTrace) console.log('tracing', x, y, {'origin': [ray[0],ray[1],ray[2]],'dir': [ray[3],ray[4],ray[5]], 'hit': hit})
								
								if(hit) {
									// calculate hit normal in world space
									// -- if uvs and normalMap are given, calculate nor, tan, bitan, and apply it
									const ai3s = ray[RAY_ABCI], bi3s = ray[RAY_ABCI+1], ci3s = ray[RAY_ABCI+2]
									const ai2s = ai3s/3*2, bi2s = bi3s/3*2, ci2s = ci3s/3*2
									const was = ray[RAY_UVW], wbs = ray[RAY_UVW+1], wcs = ray[RAY_UVW+2]
									const srcU = UVSs[ai2s  ]*was + UVSs[bi2s  ]*wbs + UVSs[ci2s  ]*wcs
									const srcV = UVSs[ai2s+1]*was + UVSs[bi2s+1]*wbs + UVSs[ci2s+1]*wcs
									const material = materials[MATs[ai3s/3]]
									if(isNormalMap){
										// source normal [world space]
										let nx1 = NORs[ai3s  ]*was + NORs[bi3s  ]*wbs + NORs[ci3s  ]*wcs
										let ny1 = NORs[ai3s+1]*was + NORs[bi3s+1]*wbs + NORs[ci3s+1]*wcs
										let nz1 = NORs[ai3s+2]*was + NORs[bi3s+2]*wbs + NORs[ci3s+2]*wcs
										
										if(material){
											let normal = material(srcU,srcV)
											let nxt = normal[0]
											let nyt = normal[1]
											let nzt = normal[2]
											// console.log('sampled normal', normal)
											let nt = 1.0/Math.sqrt(nxt*nxt+nyt*nyt+nzt*nzt)
											nxt *= nt; nyt *= nt; nzt *= nt;
											let ai4s = ai2s*2, bi4s = bi2s*2, ci4s = ci2s*2
											// convert normal map value from tangent space to world space
											// needed: normal (n1), tangent (TANs), bitangent (normal x tangent)
											let tx1 = TANs[ai4s  ]*was + TANs[bi4s  ]*wbs + TANs[ci4s  ]*wcs
											let ty1 = TANs[ai4s+1]*was + TANs[bi4s+1]*wbs + TANs[ci4s+1]*wcs
											let tz1 = TANs[ai4s+2]*was + TANs[bi4s+2]*wbs + TANs[ci4s+2]*wcs
											let tw1 = TANs[ai4s+3]*was + TANs[bi4s+3]*wbs + TANs[ci4s+3]*wcs
											// todo normalize t1 and b1
											let t1 = tx1*nx1 + ty1*ny1 + tz1*nz1
											// remove remainders of n1 in t1
											tx1 -= t1*nx1; ty1 -= t1*ny1; tz1 -= t1*nz1;
											let bx1 = (ny1*tz1-nz1*ty1)*tw1
											let by1 = (nz1*tx1-nx1*tz1)*tw1
											let bz1 = (nx1*ty1-ny1*tx1)*tw1
											nx1 = nxt*tx1 + nyt*bx1 + nzt*nx1
											ny1 = nxt*ty1 + nyt*by1 + nzt*ny1
											nz1 = nxt*tz1 + nyt*bz1 + nzt*nz1
										}
										
										let nw1 = 1.0/Math.sqrt(nx1*nx1 + ny1*ny1 + nz1*nz1)
										nx1 *= nw1
										ny1 *= nw1
										nz1 *= nw1
										
										// destination tangent [dst object space]
										let ai4d = ai2d+ai2d, bi4d = bi2d+bi2d, ci4d = ci2d+ci2d
										let tx0 = TANd[ai4d  ]*wad + TANd[bi4d  ]*wbd + TANd[ci4d  ]*wcd
										let ty0 = TANd[ai4d+1]*wad + TANd[bi4d+1]*wbd + TANd[ci4d+1]*wcd
										let tz0 = TANd[ai4d+2]*wad + TANd[bi4d+2]*wbd + TANd[ci4d+2]*wcd
										let tw0 = TANd[ai4d+3]*wad + TANd[bi4d+3]*wbd + TANd[ci4d+3]*wcd
										let tn = tx0*nx0+ty0*ny0+tz0*nz0
										tx0 -= tn*nx; ty0 -= tn*ny; tz0 -= tn*nz
										tn = 1.0/Math.sqrt(tx0*tx0+ty0*ty0+tz0*tz0)
										tx0 *= tn; ty0 *= tn; tz0 *= tn;
										
										// transform normal from [world space] to [dst object space]
										let nx2 = nx1*TRANSd[0] + ny1*TRANSd[1] + nz1*TRANSd[ 2]
										let ny2 = nx1*TRANSd[4] + ny1*TRANSd[5] + nz1*TRANSd[ 6]
										let nz2 = nx1*TRANSd[8] + ny1*TRANSd[9] + nz1*TRANSd[10]
										let nw2 = nx2*nx2+ny2*ny2+nz2*nz2
										if(nw2){
											nw2 = 1.0/Math.sqrt(nw2);
											nx2*=nw2; ny2*=nw2; nz2*=nw2;
										}
										
										// bitangent via cross product [dst object space]
										let bx0 = (ny0*tz0-nz0*ty0)*tw0
										let by0 = (nz0*tx0-nx0*tz0)*tw0
										let bz0 = (nx0*ty0-ny0*tx0)*tw0
										
										// transform normal from [dst object space] to [dst tangent space]
										// tan=x, bitan=y, nor=z
										let nx3 = nx2*tx0 + ny2*ty0 + nz2*tz0
										let ny3 = nx2*bx0 + ny2*by0 + nz2*bz0
										let nz3 = nx2*nx0 + ny2*ny0 + nz2*nz0
										
										if(0){
											// position debug
											image[q  ] = 255 * (px - bounds[0]) / (bounds[3]-bounds[0])
											image[q+1] = 255 * (py - bounds[1]) / (bounds[4]-bounds[1])
											image[q+2] = 255 * (pz - bounds[2]) / (bounds[5]-bounds[2])
										} else if(0){
											// distance debug
											image[q  ] = 255 * Math.abs(ray[RAY_DISTANCE]) / maxDelta
											image[q+1] = dist < 0 ? 0 : image[q]
											image[q+2] = dist < 0 ? 0 : image[q]
										} else {
											// normals [hopefully tangent space]
											const inv = 127/Math.sqrt(nx3*nx3 + ny3*ny3 + nz3*nz3)
											image[q  ] = nx3*inv+127
											image[q+1] = ny3*inv+127
											image[q+2] = nz3*inv+127
										}
									} else {
										if(material){
											const color = material(srcU,srcV)
											image[q  ] = color[0]
											image[q+1] = color[1]
											image[q+2] = color[2]
										} else {
											image[q] = image[q+1] = image[q+2] = 255
										}
									}
									image[q+3] = 255
								}
							}
						}
						q += 4
					}
				}
				
				dstTriIdx += 3; // we're done with this triangle :)
				
				let t1 = Date.now()
				if(t1-t0 > 33) {
					// continue later :)
					requestAnimationFrame(raytraceData)
					exportImage(image0)
					return;
				}
			}
			// we're done with this shape :), mark it as such
			dstTriIdx = -1
		}
		
		// we're done with raytracing :)
		spreadData()
		
	}
	
	let spreadI=0
	const dyi = h*4
	// propagate color onto pixels without color
	function spreadData(){
		if(session != thisSession) return;
		let done = true
		let t0 = Date.now()
		for(let z=0;z<16;z++) {
			done = true
			for(let y=0,i4=0;y<h;y++){
				for(let x=0;x<w;x++,i4+=4){
					if(image0[i4+3] < 255){
						// propagate color
						let q = 0, r = 0, g = 0, b = 0
						let d0 = x > 0, d1 = x+1 < w, d2 = y > 0, d3 = y+1 < h
						let j4 = i4-dyi, k4 = i4+dyi
						if(d0 && image0[i4-1]) { q+=2; r += image0[i4-4]*2; g += image0[i4-3]*2; b += image0[i4-2]*2; } // -x
						if(d1 && image0[i4+5]) { q+=2; r += image0[i4+4]*2; g += image0[i4+5]*2; b += image0[i4+6]*2; } // +x
						if(d2 && image0[j4+3]) { q+=2; r += image0[j4  ]*2; g += image0[j4+1]*2; b += image0[j4+2]*2; } // -y
						if(d3 && image0[k4+3]) { q+=2; r += image0[k4  ]*2; g += image0[k4+1]*2; b += image0[k4+2]*2; } // +y
						if(d0 && d2 && image0[j4-1]) { q++; r += image0[j4-4]; g += image0[j4-3]; b += image0[j4-2]; } // -x-y
						if(d1 && d2 && image0[j4+5]) { q++; r += image0[j4+4]; g += image0[j4+5]; b += image0[j4+6]; } // +x-y
						if(d0 && d3 && image0[k4-1]) { q++; r += image0[k4-4]; g += image0[k4-3]; b += image0[k4-2]; } // -x+y
						if(d1 && d3 && image0[k4+5]) { q++; r += image0[k4+4]; g += image0[k4+5]; b += image0[k4+6]; } // +x+y
						if(q){
							image1[i4  ] = r/q
							image1[i4+1] = g/q
							image1[i4+2] = b/q
							image1[i4+3] = 255
							done = false
						}
					} else {
						// copy color
						image1[i4  ] = image0[i4]
						image1[i4+1] = image0[i4+1]
						image1[i4+2] = image0[i4+2]
						image1[i4+3] = image0[i4+3]
					}
				}
			}
			
			let tmp = image1
			image1 = image0
			image0 = tmp
			
			let dt = Date.now() - t0
			if(spreadI++ > w) done = true;
			if(dt > 30 || done) break;
		}
		
		if(!done) {
			requestAnimationFrame(spreadData)
			exportImage(image0)
		} else {
			exportImage(image0, true)
			let taken = Date.now()
			console.log('done', (taken-startTime)/1e3)
		}
	}
	
	function exportImage(image0, finish) {
		if(session != thisSession) return;
		if(layer.sRGB) {
			for(let i4=0;i4<s4;i4+=4){
				image2[i4  ] = linearToSRGB[image0[i4]]
				image2[i4+1] = linearToSRGB[image0[i4+1]]
				image2[i4+2] = linearToSRGB[image0[i4+2]]
				image2[i4+3] = image0[i4+3]
			}
			image0 = image2
		}
		const imageData = new ImageData(image0,w,h)
		resCtx1.putImageData(imageData,0,0)
		if(finish) finishTexture(imageData)
	}
	
	console.log(-lastTime+(lastTime=Date.now()), 'allocating')
	
	// exportImage(image0,true)
	raytraceData()
}

export { raytraceOnCPU };
