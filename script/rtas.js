
import { random, clamp } from 'script/maths.js'

const maxNodeSize = 1

function bounds(tris,start,end){
	let tri = tris[start]
	let minx = tri[0], maxx = tri[3]
	let miny = tri[1], maxy = tri[4]
	let minz = tri[2], maxz = tri[5]
	for(let i=start+1;i<end;i++){
		tri = tris[i]
		minx = Math.min(minx,tri[0]); miny = Math.min(miny,tri[1]); minz = Math.min(minz,tri[2])
		maxx = Math.max(maxx,tri[3]); maxy = Math.max(maxy,tri[4]); maxz = Math.max(maxz,tri[5])
	}
	// console.log('bounds',start,end,[minx,miny,minz,maxx,maxy,maxz])
	return [minx,miny,minz,maxx,maxy,maxz]
}
function unionBounds(a,b){
	return [ Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.min(a[2],b[2]),
			 Math.max(a[3],b[3]), Math.max(a[4],b[4]), Math.max(a[5],b[5]) ]
}

function volume(b){ return (b[3]-b[0])*(b[4]-b[1])*(b[5]-b[2]) }

function buildBLAS0(tris,start,end) {
	const count = end-start
	if(count <= maxNodeSize){
		return [bounds(tris,start,end),start,end]
	} else {
		// bounds of centers to find largest dimension
		const end = start+count
		const dim = findSplittingDim(tris,start,end)
		const mid = findMedian(tris,start,end,dim)
		const child0 = buildBLAS0(tris,start,mid)
		const child1 = buildBLAS0(tris,mid,end)
		const union = unionBounds(child0[0],child1[0])
		return [union,child0,child1,dim]
	}
}

function findSplittingDim(tris,start,end){
	const t0 = tris[start]
	let minx = t0[6], maxx = minx
	let miny = t0[7], maxy = miny
	let minz = t0[8], maxz = minz
	for(let i=start+1;i<end;i++){
		const ti = tris[i]
		const x = ti[6]
		const y = ti[7]
		const z = ti[8]
		minx = Math.min(minx,x)
		miny = Math.min(miny,y)
		minz = Math.min(minz,z)
		maxx = Math.max(maxx,x)
		maxy = Math.max(maxy,y)
		maxz = Math.max(maxz,z)
	}
	
	// find largest delta-dim
	const dx = maxx-minx, dy = maxy-miny, dz = maxz-minz
	return dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2
}

function findMedian(tris,start,end,dim){
	// find median
	// slice: start, end
	const idx = dim + 6 // to sort by avg
	const count = end-start
	let mid = (start + end) >> 1
	let numTries = Math.log2(count) / 2
	for(let tries=0;tries<numTries;tries++){
		function sample(){
			return tris[start + ((random()*count)|0)][idx]
		}
		// avg instead of sum moved time from 360ms to 300ms for Lucy
		let sum = 0, cnt = 5
		for(let j=0;j<cnt;j++) sum += sample()
		let pivot = sum / cnt
		// partition by pivot
		let i = start - 1
		let j = end// + 1
		while(true){
			do { j--; } while(tris[j][idx] < pivot);
			do { i++; } while(tris[i][idx] > pivot);
			if(i<j) {
				let tmp = tris[i]
				tris[i] = tris[j]
				tris[j] = tmp
			} else break;
		}
		// check if partition is good enough
		let relative = j - start
		if(relative > 0.25 * count && relative < 0.75 * count) { // 50% chance
			mid = j
			break;
		}
	}
	// else partitioning will have pre-sorted the list, and we can just use mid
	return mid
}

const TRIS_AVG_IDX = 6
const TRIS_ABC_IDX = 9

function buildBLAS(pos,idx){
	// generate tris
	let t0 = Date.now()
	const tris = []
	for(let i=0;i<idx.length;){
		const ai = idx[i++]
		const bi = idx[i++]
		const ci = idx[i++]
		const ai3 = ai*3
		const bi3 = bi*3
		const ci3 = ci*3
		const ax = pos[ai3], ay = pos[ai3+1], az = pos[ai3+2]
		const bx = pos[bi3], by = pos[bi3+1], bz = pos[bi3+2]
		const cx = pos[ci3], cy = pos[ci3+1], cz = pos[ci3+2]
		tris.push([
			Math.min(ax,bx,cx),
			Math.min(ay,by,cy),
			Math.min(az,bz,cz),
			Math.max(ax,bx,cx),
			Math.max(ay,by,cy),
			Math.max(az,bz,cz),
			(ax+bx+cx),
			(ay+by+cy),
			(az+bz+cz),
			ai,bi,ci
		])
	}
	console.log(Date.now()-t0, 'collecting tris')
	// console.log(tris)
	let blas = buildBLAS0(tris,0,tris.length)
	return [blas,tris]
}

/*
let POSs = null
let NORs = null
let TANs = null
let UVSs = null
let MATs = null
let IDXs = null
let tris = null
*/

// ray: [origin,dir,inv-dir,best@9,abci@10,uvw@13]
const RAY_ORIGIN = 0
const RAY_DIR = 3
const RAY_INV_DIR = 6
const RAY_SCORE = 9
const RAY_ABCI = 10
const RAY_UVW = 13
const RAY_DISTANCE = 16

function safeMin(x,y){
	return x<y?x:y
}

function safeMax(x,y){
	return x>y?x:y
}

window.printTrace = false
function aabbHitsRay(b,ray) {
	// return true;
	const rx = ray[0], ry = ray[1], rz = ray[2]
	const rdx = ray[6], rdy = ray[7], rdz = ray[8]
	const sx0 = (b[0] - rx) * rdx
	const sy0 = (b[1] - ry) * rdy
	const sz0 = (b[2] - rz) * rdz
	const sx1 = (b[3] - rx) * rdx
	const sy1 = (b[4] - ry) * rdy
	const sz1 = (b[5] - rz) * rdz
	const nearX = safeMin(sx0, sx1)
	const nearY = safeMin(sy0, sy1)
	const nearZ = safeMin(sz0, sz1)
	const near  = safeMax(safeMax(nearX, nearY), safeMax(nearZ, -ray[9]))
	const farX = safeMax(sx0, sx1)
	const farY = safeMax(sy0, sy1)
	const farZ = safeMax(sz0, sz1)
	const far  = safeMin(farX, safeMin(farY, farZ))
	// if(printTrace) console.log(sx0,sx1,sy0,sy1,sz0,sz1,'->',nearX,farX,nearY,farY,nearZ,farZ,'->',near,far,'-',ray[9],'>',far >= near,'&&',near < ray[9])
	return far >= near && near < ray[9]
}

function triHitsRay(ai3,bi3,ci3,ray){
	
	const pos = window.POSs
	const ax = pos[ai3], ay = pos[ai3+1], az = pos[ai3+2]
	const x0 = pos[bi3  ] - ax
	const y0 = pos[bi3+1] - ay
	const z0 = pos[bi3+2] - az
	const x1 = pos[ci3  ] - ax
	const y1 = pos[ci3+1] - ay
	const z1 = pos[ci3+2] - az
	
	// normal
	const nx = y0 * z1 - z0 * y1
	const ny = z0 * x1 - x0 * z1
	const nz = x0 * y1 - y0 * x1
	
	const dist = nx * pos[ai3] + ny * pos[ai3+1] + nz * pos[ai3+2] // n * a
	const norXdir = nx*ray[RAY_DIR] + ny*ray[RAY_DIR+1] + nz*ray[RAY_DIR+2]
	if(norXdir < 0.0) return; // back-side
	const distance = (dist - (nx*ray[RAY_ORIGIN] + ny*ray[RAY_ORIGIN+1] + nz*ray[RAY_ORIGIN+2])) / norXdir
	const score = Math.abs(distance)// * (1+(norXdir)/Math.sqrt(nx*nx+ny*ny+nz*nz))
	if (score < ray[RAY_SCORE]) {
	
		// dstPosition = origin + distance * direction
		const dx = ray[RAY_ORIGIN  ] + distance * ray[RAY_DIR]
		const dy = ray[RAY_ORIGIN+1] + distance * ray[RAY_DIR+1]
		const dz = ray[RAY_ORIGIN+2] + distance * ray[RAY_DIR+2]

		// barycentric coordinates
		const x2 = dx - ax
		const y2 = dy - ay
		const z2 = dz - az
		const d00 = x0*x0 + y0*y0 + z0*z0
		const d01 = x0 * x1 + y0 * y1 + z0 * z1
		const d11 = x1*x1 + y1*y1 + z1*z1
		const d20 = x0 * x2 + y0 * y2 + z0 * z2
		const d21 = x1 * x2 + y1 * y2 + z1 * z2
		const d = 1.0 / (d00 * d11 - d01 * d01)
		const v = (d11 * d20 - d01 * d21) * d
		const w = (d00 * d21 - d01 * d20) * d
		const u = 1.0 - v - w

		const min = 0.0
		if (u >= min && v >= min && w >= min) {
			// set result
			ray[RAY_SCORE] = score
			ray[RAY_ABCI] = ai3
			ray[RAY_ABCI+1] = bi3
			ray[RAY_ABCI+2] = ci3
			ray[RAY_UVW] = u
			ray[RAY_UVW+1] = v
			ray[RAY_UVW+2] = w
			ray[RAY_DISTANCE] = distance
		}
	}
}

function trace(tris,node,ray){
	if(aabbHitsRay(node[0],ray)){
		if(node.length == 4){
			// with split dimension, has children
			// decide order based on ray-dir and dim
			const dim = node[3]
			// if(printTrace) console.log('Split',dim)
			if(ray[3+dim] > 0.0){
				trace(tris,node[1],ray)
				trace(tris,node[2],ray)
			} else {
				trace(tris,node[2],ray)
				trace(tris,node[1],ray)
			}
		} else {
			const start = node[1], end = node[2]
			if(printTrace) console.log('Tris', start, end)
			for(let i=start;i<end;i++){
				const tri = tris[i]
				const ai = tri[TRIS_ABC_IDX], bi = tri[TRIS_ABC_IDX+1], ci = tri[TRIS_ABC_IDX+2]
				// if(printTrace) console.log('Tri', ai, bi, ci)
				triHitsRay(ai*3,bi*3,ci*3,ray)
			}
		}
	} else if(printTrace) console.log('Missed AABB')
}

export { trace, buildBLAS, maxNodeSize, volume, RAY_SCORE, RAY_ABCI, RAY_UVW, RAY_DISTANCE, TRIS_ABC_IDX };
