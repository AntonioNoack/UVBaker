
import { TRIS_ABC_IDX } from 'script/rtas.js';

function mergeGeometry(src,geoData,materials,isNormalMap,needsUVs,needsTangents) {
	let posSum = 0, idxSum = 0
	for(let i=0;i<src.length;i++){
		let srcI = src[i]
		let geometry = srcI[1]
		
		let pos = geometry.attributes.position
		if(!pos) continue
		if(needsUVs && !geometry.attributes.uv) continue
		
		const index = geometry.index
		if(index) {
			let ia = index.array
			let ic0 = geometry.drawRange.start
			let ic1 = Math.min(Math.min(index.count, ia.length), ic0 + geometry.drawRange.count)
			posSum += pos.array.length
			idxSum += ic1-ic0
		} else {
			posSum += pos.array.length
			idxSum += pos.array.length/3
		}
	}
	if(idxSum == 0 || posSum == 0){ console.log('no data found!'); return; }
	
	if(isNormalMap) for(let i=0;i<src.length;i++){
		if(materials[i]) {
			needsTangents = true;
			break;
		}
	}
	
	// POSs must be shared with parent scope for raytracing
	let POSs = geoData.POSs || new Float32Array(posSum)
	let NORs = geoData.NORs || new Float32Array(posSum)
	let TANs = geoData.TANs || (needsTangents ? new Float32Array(posSum/3*4) : null)
	let UVSs = geoData.UVSs || (window.UVSs = new Float32Array(posSum/3*2))
	let MATs = geoData.MATs || new Uint16Array(posSum/3)
	let IDXs = geoData.IDXs || new Uint32Array(idxSum)
	posSum = 0; idxSum = 0;
	
	if(!geoData.done) {
		for(let k=0;k<src.length;k++){
			let srcI = src[k]
			let transform = srcI[0].elements // col-major
			let geometry = srcI[1]
			
			let pos = geometry.attributes.position
			let uvs = geometry.attributes.uv
			if(!pos) continue
			if(needsUVs && !uvs) continue
			
			let nor = geometry.attributes.normal
			let index = geometry.index
			
			pos = pos.array
			nor = nor && nor.array
			uvs = uvs && uvs.array
			
			let idx = index ? index.array : null
			let ic0 = index ? geometry.drawRange.start : 0
			let ic1 = index ? Math.min(Math.min(index.count, idx.length), ic0 + geometry.drawRange.count) : pos.length/3
			
			let matIdx = k
			
			// add data to POSs,NORs,UVSs,MATs,IDXs
			let matSum = posSum/3
			let uvsSum = matSum*2
			let tanSum = matSum*4
			for(let i=0,j=posSum;i<pos.length;i+=3,j+=3){
				// apply transform
				const px = pos[i], py = pos[i+1], pz = pos[i+2]
				POSs[j  ] = px*transform[0] + py*transform[4] + pz*transform[ 8] + transform[12]
				POSs[j+1] = px*transform[1] + py*transform[5] + pz*transform[ 9] + transform[13]
				POSs[j+2] = px*transform[2] + py*transform[6] + pz*transform[10] + transform[14]
				if(nor) {
					const nx = nor[i], ny = nor[i+1], nz = nor[i+2]
					NORs[j  ] = nx*transform[0] + ny*transform[4] + nz*transform[ 8]
					NORs[j+1] = nx*transform[1] + ny*transform[5] + nz*transform[ 9]
					NORs[j+2] = nx*transform[2] + ny*transform[6] + nz*transform[10]
				}
			}
			if(uvs) for(let i=0;i<uvs.length;i++){
				UVSs[uvsSum+i] = uvs[i]
			}
			for(let i=matSum,j=i+pos.length/3;i<j;i++){
				MATs[i] = matIdx
			}
			
			// console.log('calc-tangent?', !!(isNormalMap && uvs && materials[k]), 'by', isNormalMap, uvs, materials[k])
			if(isNormalMap && uvs && materials[k]){
				let tan = calculateTangents(pos,nor,uvs,idx,ic0,ic1)
				// console.log('-> tan:', tan)
				for(let i=0;i<tan.length;i++){
					TANs[tanSum+i] = tan[i]
				}
			}
			
			// copy indices
			if(index){
				for(let i=ic0;i<ic1;i++){
					IDXs[idxSum+i] = idxSum+idx[i]
				}
				idxSum += ic1-ic0
			} else {
				for(let i=0,l=pos.length/3;i<l;i++){
					IDXs[idxSum+i] = idxSum+i
				}
				idxSum += pos.length/3
			}
			
			posSum += pos.length
			
		}
		geoData = { done: true, POSs, NORs, TANs, UVSs, MATs, IDXs }
	}
	return geoData
}

function unpackVector2(src,idx){
	if(!src) return
	let dst = new Float32Array(idx.length*2)
	for(let i=0,k=0;k<idx.length;){
		let j=idx[k++]*2
		dst[i++] = src[j++]
		dst[i++] = src[j]
	}
	return dst
}

function unpackVector3(src,idx){
	if(!src) return
	let dst = new Float32Array(idx.length*3)
	for(let i=0,k=0;k<idx.length;){
		let j=idx[k++]*3
		dst[i++] = src[j++]
		dst[i++] = src[j++]
		dst[i++] = src[j]
	}
	return dst
}

function unpackVector4(src,idx){
	if(!src) return
	let dst = new Float32Array(idx.length*4)
	for(let i=0,k=0;k<idx.length;){
		let j=idx[k++]*4
		dst[i++] = src[j++]
		dst[i++] = src[j++]
		dst[i++] = src[j++]
		dst[i++] = src[j]
	}
	return dst
}

function unpackVector2V2(src,idx,tris){
	if(!src) return
	let dst = new Float32Array(tris.length*6)
	let i=0,k=0;
	for(;k<tris.length;){
		let tri = tris[k++]
		let ai=tri[TRIS_ABC_IDX]*2, bi=tri[TRIS_ABC_IDX+1]*2, ci=tri[TRIS_ABC_IDX+2]*2
		dst[i++] = src[ai++]
		dst[i++] = src[ai]
		dst[i++] = src[bi++]
		dst[i++] = src[bi]
		dst[i++] = src[ci++]
		dst[i++] = src[ci]
	}
	return dst
}

function unpackVector3V2(src,idx,tris){
	if(!src) return
	let dst = new Float32Array(tris.length*9)
	let i=0,k=0;
	for(;k<tris.length;){
		let tri = tris[k++]
		let ai=tri[TRIS_ABC_IDX]*3, bi=tri[TRIS_ABC_IDX+1]*3, ci=tri[TRIS_ABC_IDX+2]*3
		// console.log(k-1,'->',ai/3,bi/3,ci/3)
		dst[i++] = src[ai++]
		dst[i++] = src[ai++]
		dst[i++] = src[ai]
		dst[i++] = src[bi++]
		dst[i++] = src[bi++]
		dst[i++] = src[bi]
		dst[i++] = src[ci++]
		dst[i++] = src[ci++]
		dst[i++] = src[ci]
	}
	return dst
}

function unpackVector4V2(src,idx,tris){
	if(!src) return
	let dst = new Float32Array(tris.length*12)
	let i=0,k=0;
	for(;k<tris.length;){
		let tri = tris[k++]
		let ai=tri[TRIS_ABC_IDX]*4, bi=tri[TRIS_ABC_IDX+1]*4, ci=tri[TRIS_ABC_IDX+2]*4
		dst[i++] = src[ai++]
		dst[i++] = src[ai++]
		dst[i++] = src[ai++]
		dst[i++] = src[ai]
		dst[i++] = src[bi++]
		dst[i++] = src[bi++]
		dst[i++] = src[bi++]
		dst[i++] = src[bi]
		dst[i++] = src[ci++]
		dst[i++] = src[ci++]
		dst[i++] = src[ci++]
		dst[i++] = src[ci]
	}
	return dst
}

function unpackGeometryByIndices(src){
	// first check whether it's necessary
	let idx = src.IDXs
	let good = true
	for(let i=0;i<idx.length;i++){
		if(idx[i] != i){
			good = false
			break;
		}
	}
	if(good) return src
	console.log('unpacking')
	return {
		POSs: unpackVector3(src.POSs,idx),
		NORs: unpackVector3(src.NORs,idx),
		TANs: unpackVector4(src.TANs,idx),
		UVSs: unpackVector2(src.UVSs,idx),
	}
}

function unpackGeometryByIndicesV2(src,tris){
	let idx = src.IDXs
	return {
		POSs: unpackVector3V2(src.POSs,idx,tris),
		NORs: unpackVector3V2(src.NORs,idx,tris),
		TANs: unpackVector4V2(src.TANs,idx,tris),
		UVSs: unpackVector2V2(src.UVSs,idx,tris),
	}
}

function calculateTangents(pos,nor,uvs,idx,ic0,ic1){
	let tan1 = new Float32Array(nor.length/3*4)
	let tan2 = new Float32Array(nor.length/3*4)
	for(let i=ic0;i<ic1;){
		
		// vertex indices
		let i0 = idx ? idx[i++] : i++
		let i1 = idx ? idx[i++] : i++
		let i2 = idx ? idx[i++] : i++
		
		let i02 = i0 + i0, i03 = i0 + i02, i04 = i02 + i02
		let i12 = i1 + i1, i13 = i1 + i12, i14 = i12 + i12
		let i22 = i2 + i2, i23 = i2 + i22, i24 = i22 + i22
		
		let v0x = pos[i03], v0y = pos[i03 + 1], v0z = pos[i03 + 2]
		let v1x = pos[i13], v1y = pos[i13 + 1], v1z = pos[i13 + 2]
		let v2x = pos[i23], v2y = pos[i23 + 1], v2z = pos[i23 + 2]
		
		let x1 = v1x - v0x
		let x2 = v2x - v0x
		let y1 = v1y - v0y
		let y2 = v2y - v0y
		let z1 = v1z - v0z
		let z2 = v2z - v0z
		
		let w0x = uvs[i02]
		let w0y = uvs[i02 + 1]
		
		let s1 = uvs[i12] - w0x
		let s2 = uvs[i22] - w0x
		let t1 = uvs[i12 + 1] - w0y
		let t2 = uvs[i22 + 1] - w0y
		
		function add(v,i,x,y,z){
			v[i] += x; v[i+1] += y; v[i+2] += z
		}
		
		let area = s1*t2-s2*t1
		if(Math.abs(area)>1e-16){
			let r = 1.0 / area
			let sx = (t2 * x1 - t1 * x2) * r
			let sy = (t2 * y1 - t1 * y2) * r
			let sz = (t2 * z1 - t1 * z2) * r
			add(tan1, i04, sx, sy, sz)
			add(tan1, i14, sx, sy, sz)
			add(tan1, i24, sx, sy, sz)

			let tx = (s1 * x2 - s2 * x1) * r
			let ty = (s1 * y2 - s2 * y1) * r
			let tz = (s1 * z2 - s2 * z1) * r
			add(tan2, i04, tx, ty, tz)
			add(tan2, i14, tx, ty, tz)
			add(tan2, i24, tx, ty, tz)
		}
	}
	for(let i=0,j=0;i<nor.length;){
		let nx = nor[i++]
		let ny = nor[i++]
		let nz = nor[i++]
		let sx = tan1[j]
		let sy = tan1[j+1]
		let sz = tan1[j+2]
		let dot = nx*sx+ny*sy+nz*sz
		sx -= nx * dot
		sy -= ny * dot
		sz -= nz * dot
		let r = 1.0/Math.sqrt(sx*sx+sy*sy+sz*sz)
		if(Math.abs(r)<1e38){
			let hv = (ny*sz-nz*sy)*tan2[j] + (nz*sx-nx*sz)*tan2[j+1] + (nx*sy-ny*sx)*tan2[j+2]
			tan1[j++] = sx*r
			tan1[j++] = sy*r
			tan1[j++] = sz*r
			tan1[j++] = Math.sign(hv)
		} else {
			// console.log('skipping', i-3, j, r, [nx,ny,nz], [sx,sy,sz])
			j+=4;
		}
	}
	return tan1
}

export { mergeGeometry, calculateTangents, unpackGeometryByIndices, unpackGeometryByIndicesV2 };
