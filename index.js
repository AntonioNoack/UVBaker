
// src: build acceleration structure
// dst: raytrace respective data from pos+dir, onto uv, and project it

import * as THREE from 'three'
import { OrbitControls } from 'three/controls/OrbitControls.js';
import { EffectComposer } from 'three/postprocessing/EffectComposer.js';
import { TAARenderPass } from 'three/postprocessing/TAARenderPass.js';
import { RGBELoader } from 'three/loaders/RGBELoader.js';
import { Loader } from 'loaderjs'

// GPU path isn't working yet
let useGPU = true
let useWebGL2 = true

const maxNodeSize = 1
// useGPU ? 'MetallicSphere1.glb' : 'cube.obj' //'cube gradient.glb'
const file0 = 'MetallicSphere1.glb'
const file1 = 'cube.obj'

window.src = []

let renderers = []
let renderers2 = []
let cameras = window.cameras = []
let scenes = []
let data = window.data = [[],[]]
let controls2 = []

let extra = titleSrc.getBoundingClientRect().bottom
let w = window.innerWidth, h = window.innerHeight-extra

const normalMat = new THREE.MeshNormalMaterial()
const displayMat0 = new THREE.MeshStandardMaterial()
const displayMat1 = new THREE.MeshPhongMaterial()
let displayMat = displayMat1

let rndState = 12635

function xoshiro128ss(a, b, c, d) {
    return function() {
        let t = b << 9, r = b * 5; r = (r << 7 | r >>> 25) * 9;
        c ^= a; d ^= b;
        b ^= c; a ^= d; c ^= t;
        d = d << 11 | d >>> 21;
		// >>>0 makes the number unsigned, Magic 😄
        return (r>>>0) / 4294967296;
    }
}

let random = xoshiro128ss(-2121261364, 25226896, -1525018226, -926567007)
// let random = Math.random

function clamp(x,min,max){
	return x<min?min:x<max?x:max
}

function create(div,idx){
	
	const models = []

	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(75, w/(3*h), 0.1, 1000)

	const renderer = window.renderer = new THREE.WebGLRenderer({ alpha: true })
	renderer.setSize(w*0.326, h)
	renderer.setClearColor(0, 0)
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1
	div.appendChild(renderer.domElement)

	const sun = new THREE.DirectionalLight(0xffffee, 2.0)
	sun.position.set(-10,3.8,3) // inverse direction, because target = 0
	scene.add(sun)

	const sun2 = new THREE.DirectionalLight(0xaaaaff, 0.1)
	sun2.position.set(10,-3.8,-3) // inverse direction, because target = 0
	scene.add(sun2)

	const ambient = new THREE.AmbientLight(0xffffff, 0.2)
	scene.add(ambient)
	scene.add(sun.target)

	camera.position.z = 3

	scene.background = null

	const controls = new OrbitControls( camera, renderer.domElement )
	controls.listenToKeyEvents(div)
	controls2.push(controls)
	
	// rotate camera initially
	controls.minAzimuthAngle = 0.63
	controls.maxAzimuthAngle = controls.minAzimuthAngle
	controls.minPolarAngle = Math.PI/2-0.5
	controls.maxPolarAngle = controls.minPolarAngle
	controls.update()
	controls.minAzimuthAngle = -1e308
	controls.maxAzimuthAngle = +1e308
	controls.minPolarAngle = 0
	controls.maxPolarAngle = Math.PI
	
	let cancelEvent = (e) => { e.preventDefault(); e.stopPropagation() }
	div.addEventListener('dragenter', cancelEvent, false)
	div.addEventListener('dragleave', cancelEvent, false)
	div.addEventListener('dragover',  cancelEvent, false)
	let title = div.getElementsByTagName('p')[0]
	function loadFiles(e){
		scene.background = null;
		session++;
		
		if(idx == 0) {
			blas = null;
			matList = null;
			srcGeoData = {}
		}
		
		console.log('removing '+models.length+' models')
		for(let i=0;i<models.length;i++){
			scene.remove(models[i])
		}
		models.splice(0,models.length)
		data[idx].splice(0,data[idx].length)
		
		function process(sc){
			const model = sc.scene || sc
			collectData(model,idx,idx)
			models.push(model)
			scene.add(model)
			camSetup(model,controls,camera)
		}
		
		new Loader(process).load(e);
	}
	let movement = 0
	title.addEventListener('mousedown', (e) => {
		movement = 0
	})
	title.addEventListener('mousemove', (e) => {
		let dx=e.movementX,dy=e.movementY
		movement += Math.hypot(dx,dy)
	})
	title.addEventListener('click', (e) => {
		if(movement < 7){
			let input = document.createElement('input')
			input.type = 'file'
			input.onchange = (e) => { loadFiles({ dataTransfer: e.target }) }
			input.click()
		}
	})
	div.addEventListener('drop', (e) => {
		e.preventDefault(); e.stopPropagation()
		loadFiles(e)
	}, false)
	
	if(1){
		const composer = new EffectComposer(renderer)
		const taaPass = new TAARenderPass(scene, camera)
		// taaPass.unbiased = false // this line introduced banding :/
		taaPass.sampleLevel = 3 // 2 is good, 3 is excellent :)
		// taaPass.accumulate = true // doesn't render anything anymore
		
		composer.addPass(taaPass)
		renderers.push(composer)
	} else {
		renderers.push(renderer)
	}
	renderers2.push(renderer)
	cameras.push(camera)
	scenes.push(scene)
	return models

}


function splitByMaterial(geometry, materials) {
	var parts = [], geo, vMap, iMat
	function addPart() {
		var mat = materials[iMat]
		parts.push(new THREE.Mesh(geo, mat))
	}
	geometry.faces.forEach((face) => {
		if(face.materialIndex != iMat) {
			if(iMat !== undefined)
				addPart();
			geo = new THREE.Geometry()
			vMap = {}
			iMat = face.materialIndex
		}
		var f = face.clone()
		['a','b','c'].forEach((p) => {
			var iv = face[p]
			if(!vMap.hasOwnProperty(iv))
				vMap[iv] = geo.vertices.push(geometry.vertices[iv]) - 1;
			f[p] = vMap[iv]
		})
		geo.faces.push(f)
	})
	addPart()
	return parts
}

function collectData(model,i){
	model.traverseVisible(it => {
		if(it instanceof THREE.Mesh) {
			
			let matrix = it.matrixWorld
			
			function add(it, geo, mat) {
				let isPhong = it.material instanceof THREE.MeshPhongMaterial
				if(i == 0 && (isPhong != (displayMat == displayMat1))){
					displayMat = isPhong ? displayMat1 : displayMat0
					// shadersUI.value = isPhong ? "1" : "0"
					updatePreviewMaterial()
				}
				// data: diffuse (map), emissive (emissiveMap), normals (normalMap), ao (aoMap),
				//  metalnessMap, roughnessMap
				data[i].push([matrix, geo, mat, it])
			}
			
			console.log('mesh:', it)
			let mat = it.material
			if(i == 1) it.material = displayMat
			if(false && Array.isArray(mat) && it.geometry.faces) { // untested
				splitByMaterial(it.geometry, mat).forEach(x => {
					add(x, x.geometry, x.material)
				})
			} else {
				add(it, it.geometry, mat)
			}
			
		}
	})
}

function updatePreviewMaterial(){
	let meshes = data[1]
	for(let i=0;i<meshes.length;i++) {
		meshes[i][3].material = displayMat
	}
}

function camSetup(model, controls, camera){
	const bounds = new THREE.Box3().setFromObject(model,true)
	const dist = 1.3 * Math.max(bounds.max.x-bounds.min.x,bounds.max.y-bounds.min.y,bounds.max.z-bounds.min.z)
	bounds.getCenter(controls.target)
	controls.minPolarAngle = 1.57
	controls.maxPolarAngle = 1.57
	controls.minDistance = dist * 0.01
	controls.maxDistance = dist * 3.0
	controls.update()
	controls.minPolarAngle = 0
	controls.maxPolarAngle = Math.PI
	camera.near = dist * 0.001
	camera.far = dist * 3.0
}

const srcModels = create(divSrc,0)
const dstModels = create(divDst,1)
const modelss = [srcModels,dstModels]

function process(scene,i){
	const model = scene.scene || scene
	collectData(model,i,i)
	modelss[i].push(model)
	scenes[i].add(model)
	camSetup(model,controls2[i],cameras[i])
	if(modelss[0].length && modelss[1].length) bake()
}

function animate() {
	requestAnimationFrame(animate)
	for(let i=0;i<renderers.length;i++){
		renderers[i].render(scenes[i], cameras[i])
	}
}
animate()

function onWindowResize(){
	let w = window.innerWidth*0.326, h = window.innerHeight-extra
	for(let i=0;i<2;i++){
		cameras[i].aspect = w / h
		cameras[i].updateProjectionMatrix()
		renderers[i].setSize(w, h)
		renderers2[i].setSize(w, h)
	}
}
window.addEventListener('resize', onWindowResize, false);

// a single BLAS should be good enough
// + less complexity
// - redundant data
// - repeated meshes cause data to explode

// triangle: [min,max,avg,ai,bi,ci], v0=min,v1=avg,v2=max

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

let POSs = null
let NORs = null
let TANs = null
let UVSs = null
let MATs = null
let IDXs = null
let tris = null

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

let printTrace = false
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
	
	const pos = POSs
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

function trace(node,ray){
	if(aabbHitsRay(node[0],ray)){
		if(node.length == 4){
			// with split dimension, has children
			// decide order based on ray-dir and dim
			const dim = node[3]
			if(printTrace) console.log('Split',dim)
			if(ray[3+dim] > 0.0){
				trace(node[1],ray)
				trace(node[2],ray)
			} else {
				trace(node[2],ray)
				trace(node[1],ray)
			}
		} else {
			const start = node[1], end = node[2]
			if(printTrace) console.log('Tris', start, end)
			for(let i=start;i<end;i++){
				const tri = tris[i]
				const ai = tri[TRIS_ABC_IDX], bi = tri[TRIS_ABC_IDX+1], ci = tri[TRIS_ABC_IDX+2]
				if(printTrace) console.log('Tri', ai, bi, ci)
				triHitsRay(ai*3,bi*3,ci*3,ray)
			}
		}
	} else if(printTrace) console.log('Missed AABB')
}

let resCtx1 = resCanvas1.getContext('2d', { antialias: false })
let resCtx2 = resCanvas2.getContext(useWebGL2 ? 'webgl2' : 'webgl')
const layers = [
	{ name: "Normals",   maps: ["normalMap", "normalScale"], isNormalMap: true,
		display0: "normalMap", display1: "normalMap" },
	{ name: "Diffuse",   maps: ["map", "color"], alphaMaps: ["alphaMap"], sRGB: true,
		display0: "map", display1: "map" },
	{ name: "Emissive",  maps: ["emissive", "emissiveIntensity", "emissiveMap"], sRGB: true,
		display0: "emissiveMap", display1: "emissiveMap" },
	{ name: "Roughness", channel: 1, maps: ["roughness", "roughnessMap"], invMaps: ["reflectivity"], expMaps: ["shininess"],
		display0: "roughnessMap", display1: "" }, // green channel
	{ name: "Metallic",  channel: 2, maps: ["specular", "specularMap", "metalness", "metalnessMap"], 
		display0: "metalnessMap", display1: "specularMap" }, // blue channel
	{ name: "AO Map",    channel: 0, maps: ["aoMap", "aoMapIntensity"],
		display: "aoMap", display1: "aoMap" }, // red channel
	// todo option for bump maps, displacement maps?
]

let layer = layers[0]
layersUI.onchange = function(){
	let newLayer = layers[layersUI.value*1]
	if(newLayer != layer){
		layer = newLayer
		matList = null
	}
}

/*shadersUI.onchange = function(){
	displayMat = shadersUI.value*1 ? displayMat1 : displayMat0
	updatePreviewMaterial()
}
shadersUI.value = displayMat == displayMat0 ? "0" : "1"*/

processorUI.onchange = function(){
	useGPU = processorUI.value == "0"
	matList = null
}
for(let i=0;i<layers.length;i++) {
	let e = document.createElement('option')
	e.value = i
	e.innerHTML = layers[i].name
	layersUI.appendChild(e)
}

let renderer = new THREE.WebGLRenderer()
let images = {}
let session = 0

function mix2d(v00,v01,v10,v11,fx,fy){
	let gx = 1-fx, gy = 1-fy
	return (v00*gy+fy*v01)*gx+fx*(v10*gy+fy*v11)
}

function loadImage(map){
	
	let image = images[map]
	if(image) return image;
	
	if(!map.image) return;
	let width = map.image.width, height = map.image.height
	if(width * height < 10){
		width *= 3; height *= 3
	}
	renderer.setSize(width,height)
	const target = new THREE.WebGLRenderTarget(width,height)
	const data = new Uint8ClampedArray(width*height*4)
	renderer.setRenderTarget(target)
	const scene = new THREE.Scene()
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.MeshBasicMaterial({ map }))
	scene.add(mesh)
	mesh.position.z = -1
	const camera = new THREE.Camera()
	camera.aspect = width/height
	renderer.render(scene, camera)
	renderer.readRenderTargetPixels(target,0,0,width,height,data)
	target.dispose()
	let allZero = true
	for(let i=0;i<data.length;i++) {
		if(data[i]) {
			allZero = false; break;
		}
	}
	if(!allZero){
		resCanvas1.width = width
		resCanvas1.height = height
		resCtx1.putImageData(new ImageData(data,width,height),0,0)
		image = {width,height,data}
		// throw 'see image '+maps[i]+' for '+material.name + ' ' + w+'x'+h
	} else {
		image = null
		console.log('blank image :/')
	}
	return image
}

function loadMaterials(materials,k,thisSession,callback){
	let src = data[0]
	if(k>=src.length) return callback()
	let srcI = src[k]
	let geometry = srcI[1]
	let material = srcI[2]
	if(Array.isArray(material)) {
		if(material.length > 1) alert('Only supports one material, maybe try GLTF! Using first material.')
		material = material[0]
	}
	let pos = geometry.attributes.position
	if(pos) {
		let maps = layer.maps || []
		let invMaps = layer.invMaps || []
		let expMaps = layer.expMaps || []
		let image = null, tint = [1,1,1,1]
		let invImage = false; // todo respect that
		for(let i=0;i<maps.length;i++){
			let map = material[maps[i]]
			if(map !== null && map !== undefined) {
				if(map instanceof THREE.Texture){
					if(session != thisSession) return;
					image = loadImage(map)
				} else if(map instanceof THREE.Color){
					tint[0] *= map.r
					tint[1] *= map.g
					tint[2] *= map.b
				} else if(map instanceof THREE.Vector2){
					tint[0] *= map.x
					tint[1] *= map.y
				} else if(!isNaN(map)){
					tint[0] *= map
					tint[1] *= map
					tint[2] *= map
				} else console.log('todo, material value:', map)
			}
		}
		for(let i=0;i<invMaps.length;i++){
			let map = material[invMaps[i]]
			if(map !== null && map !== undefined) {
				if(map instanceof THREE.Texture){
					if(session != thisSession) return;
					image = loadImage(map)
				} else if(map instanceof THREE.Color){
					tint[0] *= map.r
					tint[1] *= map.g
					tint[2] *= map.b
				} else if(map instanceof THREE.Vector2){
					tint[0] *= map.x
					tint[1] *= map.y
				} else if(!isNaN(map)){
					tint[0] *= map
					tint[1] *= map
					tint[2] *= map
				} else console.log('todo, inv material value:', map)
			}
		}
		for(let i=0;i<expMaps.length;i++){
			let map = material[expMaps[i]]
			if(map != undefined){
				console.log(expMaps[i]+':', map)
				if(!isNaN(map)){
					map = 1/(1+map/30)
					tint[0] *= map
					tint[1] *= map
					tint[2] *= map
				} else console.log('todo, exp material value:', map)
			}
		}
		if(useGPU) {
			materials.push(!layer.isNormalMap || image ? {image,tint} : null)
		} else {
			const tinted = tint[0] != 1 || tint[1] != 1 || tint[2] != 1 || tint[3] != 1
			if(image == null && tinted) {
				for(let i=0;i<4;i++) tint[i] *= 255
			}
			const isDefault = image == null && (!tinted || layer.isNormalMap)
			const offset = layer.isNormalMap ? 127 : 0
			const ch = layer.channel
			const single = ch !== undefined
			materials.push(isDefault ? null : (u,v) => {
				if(image){
					// sample from image
					// todo linear interpolation
					// todo sample whole section using dx,dy...
					const w = image.width, h = image.height
					u -= Math.floor(u)
					v -= Math.floor(v)
					const x = u*w-0.5
					const y = v*h-0.5
					const x0 = Math.min(x|0,w-1), y0 = Math.min(y|0,h-1), fx = x-x0, fy=y-y0
					const x1 = x0+1>=w ? 0 : x0+1, y1 = y0+1>=h ? 0 : y0+1
					const idx0 = ((x0)+(y0)*w)*4
					const idx1 = ((x0)+(y1)*w)*4
					const idx2 = ((x1)+(y0)*w)*4
					const idx3 = ((x1)+(y1)*w)*4
					const pixels = image.data
					if(single){
						const data = (mix2d(pixels[idx0+ch],pixels[idx1+ch],pixels[idx2+ch],pixels[idx3+ch],fx,fy)-offset)*tint[0]
						return [ data, data, data, 255 ]
					} else {
						return [
							(mix2d(pixels[idx0  ],pixels[idx1  ],pixels[idx2  ],pixels[idx3  ],fx,fy)-offset)*tint[0],
							(mix2d(pixels[idx0+1],pixels[idx1+1],pixels[idx2+1],pixels[idx3+1],fx,fy)-offset)*tint[1],
							(mix2d(pixels[idx0+2],pixels[idx1+2],pixels[idx2+2],pixels[idx3+2],fx,fy)-offset)*tint[2],
							 mix2d(pixels[idx0+3],pixels[idx1+3],pixels[idx2+3],pixels[idx3+3],fx,fy)*tint[3]
						]
					}
				} else return tint
			})
		}
	}
	loadMaterials(materials,k+1,thisSession,callback)
}

let startTime = 0
function bake(){
	startTime = Date.now()
	let thisSession = ++session
	let materials = []
	if(matList){
		bake1(matList,thisSession)
	} else loadMaterials(materials,0,thisSession,() => {
		matList = materials
		bake1(materials,thisSession)
	})
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

const linearToSRGB = new Uint8ClampedArray(256)
for(let i=0;i<256;i++){
	linearToSRGB[i] = Math.max(269 * Math.pow(i/255, 1.0/2.4) - 14, 0);
}

let blas = null
let matList = null
let srcGeoData = {}
let dstGeoData = {}

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
	POSs = geoData.POSs || new Float32Array(posSum)
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

function finishTexture(imageData){
	const texture = new THREE.Texture(imageData)
	texture.needsUpdate = true
	console.log('applying', texture, 'to', displayMat0, displayMat1, '.', layer.display0, layer.display1)
	displayMat0[layer.display0] = texture
	displayMat1[layer.display1] = texture
	if(layer.display0 == 'emissiveMap') {
		// multiplicative
		displayMat0.emissive = new THREE.Color(-1)
		displayMat1.emissive = new THREE.Color(-1)
	}
	if(layer.display0 == 'metalnessMap') {
		// multiplicative
		displayMat0.metalness = 1
		displayMat1.metalness = 1
	}
	displayMat0.needsUpdate = true
	displayMat1.needsUpdate = true
}

function bake1(materials,thisSession) {
	
	let lastTime = startTime
	console.log(-lastTime+(lastTime=Date.now()), 'collecting materials, gpu?', useGPU)
	
	let isNormalMap = !!layer.isNormalMap
	let w = resolutionUI.value*1, h = w
	resCanvas1.width = w
	resCanvas1.height = h
	resCanvas2.width = w
	resCanvas2.height = h
	
	const src = data[0]
	const dst = data[1]
	
	if(useGPU) {
		resCanvas1.style.display = 'none'
		resCanvas2.style.display = ''
		let image = raytraceOnGPU(w,h,src,dst,materials)
		console.log(-lastTime+(lastTime=Date.now()), 'raytracing')
		if(image) finishTexture(image)
		// exportImage(image.data,true)
		console.log(-lastTime+(lastTime=Date.now()), 'exporting')
		console.log(lastTime-startTime, 'total')
		return;
	} else {
		resCanvas2.style.display = 'none'
		resCanvas1.style.display = ''
	}
	
	// build acceleration structure :)
	// for simplicity, concat all src models into one
	srcGeoData = mergeGeometry(src,srcGeoData,materials,isNormalMap,false,false)
	if(!srcGeoData) {
		srcGeoData = {}
		alert('Destination mesh needs UVs!')
		return;
	}
	
	const POSs = srcGeoData.POSs
	const NORs = srcGeoData.NORs
	const UVSs = srcGeoData.UVSs
	const TANs = srcGeoData.TANs
	const MATs = srcGeoData.MATs
	const IDXs = srcGeoData.IDXs
	
	console.log(-lastTime+(lastTime=Date.now()), 'merging geometry + tangents')
	
	blas = blas || buildBLAS(POSs,IDXs)
	const root = blas[0]
	const bounds = root[0]
	tris = blas[1]
	
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
								printTrace = false // x == 4 && y == 0
								trace(root,ray)
								
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
exeButton.onclick = bake
cancelButton.onclick = () => {
	session++;
}
downloadButton.onclick = () => {
	const link = document.createElement('a')
	link.download = layer.name + '.png'
	link.href = (useGPU ? resCanvas2 : resCanvas1).toDataURL()
	link.click()
}
resetButton.onclick = () => {
	for(let i=0;i<layers.length;i++){
		let layer = layers[i]
		displayMat0[layer.display0] = null
		displayMat1[layer.display1] = null
	}
	let black = new THREE.Color(0)
	displayMat0.emissive = black
	displayMat1.emissive = black
	displayMat0.metalness = 0
	displayMat1.metalness = 0
	displayMat0.needsUpdate = true
	displayMat1.needsUpdate = true
}

new Loader((s) => process(s,0)).loadPath(file0)
new Loader((s) => process(s,1)).loadPath(file1)
window.THREE = THREE
if(1){
	let bgImg = new Image()
	bgImg.onload = function(){
		resCanvas1.width=bgImg.width
		resCanvas1.height=bgImg.height
		resCtx1.drawImage(bgImg,0,0)
		let data = resCtx1.getImageData(0,0,bgImg.width,bgImg.height)
		let rgba = data.data, w = data.width, h = data.height
		let floats = new Float32Array(w*h*3)
		let max = 255.5, invMax = 1.0/max
		for(let i=0,j=0,l=w*h*4;i<l;i+=4,j+=3){
			let r = rgba[i]*invMax, g = rgba[i+1]*invMax, b = rgba[i+2]*invMax
			r = r*r; g = g*g; b = b*b; // srgb -> linear
			r /= 1-r; g /= 1-g; b /= 1-b;
			floats[j] = r; floats[j+1] = g; floats[j+2] = b;
		}
		// we could use half floats, too :)
		let texture = new THREE.DataTexture(floats,w,h,THREE.RGBFormat,THREE.FloatType)
		texture.mapping = THREE.EquirectangularReflectionMapping
		texture.flipY = true
		scenes[0].environment = texture
		scenes[1].environment = texture
	}
	bgImg.src = 'env/scythian_tombs_2_4k_30.webp'
} else {
	new RGBELoader()
		.load('env/scythian_tombs_2_1k.hdr', function ( texture ) {
			// todo we need to unpack the data
			console.log(texture)
			texture.mapping = THREE.EquirectangularReflectionMapping;
			scenes[0].environment = texture
			scenes[1].environment = texture
		});
}

let gl = resCtx2
let flatBuffer = null
let flatShader = null
let flatLoc = 0
let spreadShader = null
let rtShader = null
if(useGPU){
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
	console.log('fp-textures supported?', gl.getExtension("OES_texture_float"), gl.getExtension("OES_texture_float_linear"))
	console.log('half-fp-textures supported?', gl.getExtension("OES_texture_half_float"), gl.getExtension("OES_texture_half_float_linear"))
	flatBuffer = createBuffer(new Float32Array([
		0.0, 0.0,
		0.0, 2.0,
		2.0, 0.0,
	]))
	flatShader = createProgram(`
in vec2 uvs;
out vec2 uv;
void main(){
	gl_Position = vec4((uv=uvs)*2.0-1.0, 0.0, 1.0);
}`,`
precision highp float;
in vec2 uv;
out vec4 result;
uniform sampler2D tex0;
void main(){
	result = clamp(texture(tex0,uv),vec4(0.0),vec4(1.0));
}`)
	flatLoc = gl.getAttribLocation(flatShader,'uvs')
	
	spreadShader = createProgram(`
in vec2 uvs;
out vec2 uv;
uniform vec2 duv;
void main(){
	gl_Position = vec4((uv=uvs)*2.0-1.0,0.5,1.0);
}`,`
precision highp float;
in vec2 uv;
out vec4 result;
uniform vec2 duv;
uniform sampler2D tex;
void main(){
	vec4 color = texture(tex,uv);
	if(color.a == 0.0){
		color += 2.0 * (texture(tex,uv+vec2(+duv.x,0.0)) + texture(tex,uv+vec2(-duv.x,0.0)) + texture(tex,uv+vec2(0.0,+duv.y)) + texture(tex,uv+vec2(0.0,-duv.y)));
		color += (texture(tex,uv+vec2(+duv.x,+duv.y)) + texture(tex,uv+vec2(+duv.x,-duv.y)) + texture(tex,uv+vec2(-duv.x,+duv.y)) + texture(tex,uv+vec2(-duv.x,-duv.y)));
		if(color.a > 0.0){
			color.rgb /= color.a;
			color.a = 1.0;
		}
	}
	result = color;
}`)
	rtShader = createProgram(`
in vec3 dstCoords, dstNormals;
in vec4 dstTangents;
in vec2 dstUVs;
out vec3 dstCoord, dstNormal;
out vec4 dstTangent;
out vec2 dstUV;
void main(){
	dstUV = dstUVs;
	vec2 prep = dstUV*2.0;
	gl_Position = vec4(prep-1.0, 0.0, 1.0);
	dstCoord = dstCoords;
	dstNormal = dstNormals;
	dstTangent = dstTangents;
}`, `
precision highp float;
precision highp int;
in vec3 dstCoord, dstNormal;
in vec4 dstTangent;
in vec2 dstUV;
/*uniform sampler2D tex0,tex1,tex2,tex3,tex4,tex5,tex6,tex7;
vec4 texById(vec2 uv, int id){
	switch(id){
	case 0: return texture(tex0,uv,0.0);
	case 1: return texture(tex1,uv,0.0);
	case 2: return texture(tex2,uv,0.0);
	case 3: return texture(tex3,uv,0.0);
	case 4: return texture(tex4,uv,0.0);
	case 5: return texture(tex5,uv,0.0);
	case 6: return texture(tex6,uv,0.0);
	case 7: return texture(tex7,uv,0.0);
	default: return vec4(1.0);
	}
}*/
vec3 rd, dir;
float far;
float safe(float a, float b){ return a < b || a > b ? a : b; }
float safeMin(float a, float b){ return a < b ? a : b; }
float safeMax(float a, float b){ return a > b ? a : b; }
vec3 safeMin(vec3 a, vec3 b){ return vec3(safeMin(a.x,b.x),safeMin(a.y,b.y),safeMin(a.z,b.z)); }
vec3 safeMax(vec3 a, vec3 b){ return vec3(safeMax(a.x,b.x),safeMax(a.y,b.y),safeMax(a.z,b.z)); }
float minComp(vec3 v){ return min(v.x,min(v.y,v.z)); }
float maxComp(vec3 v){ return max(v.x,max(v.y,v.z)); }
bool aabbHitsRay(vec3 bMin, vec3 bMax){
	bvec3 neg   = lessThan(rd, vec3(0.0));
	vec3  close = mix(bMin,bMax,neg);
	vec3  far3  = mix(bMax,bMin,neg);
	float tMin  = maxComp((close-dstCoord)*rd);
	float tMax  = minComp((far3-dstCoord)*rd);
	return max(tMin, -far) <= min(tMax, far);
}
float pointInOrOn(vec3 p1, vec3 p2, vec3 a, vec3 b){
	vec3 ba  = b-a;
	vec3 cp1 = cross(ba, p1 - a);
	vec3 cp2 = cross(ba, p2 - a);
	return dot(cp1, cp2);
}
bool intersectTriangle(vec3 p0, vec3 p1, vec3 p2, inout vec3 weights){
	vec3 N = cross(p1-p0, p2-p0);
	float dnn = dot(dir, N);
	if(dnn <= 0.0) return false;
	float distance = dot(p0-dstCoord, N) / dnn;
	vec3 px = dstCoord + dir * distance;
	distance = abs(distance);
	if(distance < far){
		float w0 = pointInOrOn(px, p0, p1, p2);
		float w1 = pointInOrOn(px, p1, p2, p0);
		float w2 = pointInOrOn(px, p2, p0, p1);
		if(w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0){
			far = distance;
			weights = vec3(w0,w1,w2)/(w0+w1+w2);
			return true;
		}
	}
	return false;
}
uniform bool isSingleChannel, isNormalMap, isColor;
uniform vec4 channelMask;
uniform vec4 tint;
uniform sampler2D dataTex;
uniform sampler2D posTex, blasTex, norTex, uvsTex, tanTex;
uniform uint numTris, numNodes;
uniform vec2 depthScale;
out vec4 result;
void main(){
	// ray: dstCoord, dstNormal
	// max-dist?
	dir = normalize(dstNormal);
	rd = 1.0 / dir;
	far = depthScale.y;
	uint nodeIndex = 0u;
	uint stackIndex = 0u;
	uint nextNodeStack[64];
	uint k = 0u;
	uint triTexSize  = uint(textureSize(posTex, 0).x);
	uint nodeTexSize = uint(textureSize(blasTex,0).x);
	vec3 weights = vec3(0.1);
	uint bestX = 0u, bestY = 0u;
	// traverse scene
	while(k++ < 512u){
		uint pixelIndex = nodeIndex * 2u;
		uint nodeY = pixelIndex / nodeTexSize;
		uint nodeX = pixelIndex - nodeY * nodeTexSize;
		vec4 d0 = texelFetch(blasTex,ivec2(nodeX,   nodeY),0);
		vec4 d1 = texelFetch(blasTex,ivec2(nodeX+1u,nodeY),0);
		if(aabbHitsRay(d0.xyz,d1.xyz)){
			uvec2 v01 = uvec2(d0.w,d1.w);
			if(v01.x < 3u){
				if(rd[v01.x] > 0.0){
					nextNodeStack[stackIndex++] = v01.y;
					nodeIndex++;
				} else {
					nextNodeStack[stackIndex++] = nodeIndex+1u;
					nodeIndex = v01.y;
				}
			} else {
				uint index = v01.x - 3u, end = index + min(v01.y,3u*`+maxNodeSize+`u);
				uint triY = index / triTexSize;
				uint triX = index - triY * triTexSize;
				for(;index<end;index+=3u){
					ivec2 uv0 = ivec2(triX,triY);
					ivec2 uv1 = ivec2(triX+1u,triY);
					ivec2 uv2 = ivec2(triX+2u,triY);
					vec3 p0 = texelFetch(posTex,uv0,0).xyz;
					vec3 p1 = texelFetch(posTex,uv1,0).xyz;
					vec3 p2 = texelFetch(posTex,uv2,0).xyz;
					if(intersectTriangle(p0, p1, p2, weights)){
						bestX = triX; bestY = triY;
					}
					triX += 3u;
					if(triX >= triTexSize){
						triX = 0u; triY++; // next row if needed
					}
				}
				if(stackIndex == 0u) break;
				nodeIndex = nextNodeStack[--stackIndex];
			}
		} else {
			if(stackIndex == 0u) break;
			nodeIndex = nextNodeStack[--stackIndex];
		}
	}
	
	if(far >= depthScale.y) discard;
	// gl_FragDepth = clamp(far * depthScale.x,0.0,1.0);
	
	ivec2 uv0=ivec2(bestX, bestY),uv1=ivec2(bestX+1u, bestY),uv2=ivec2(bestX+2u, bestY);
	
	vec2 srcUV =
		texelFetch(uvsTex,uv0,0).xy * weights.x +
		texelFetch(uvsTex,uv1,0).xy * weights.y +
		texelFetch(uvsTex,uv2,0).xy * weights.z;
	
	if(isNormalMap) {
		
		vec3 srcNormal = 
			texelFetch(norTex,uv0,0).xyz * weights.x + 
			texelFetch(norTex,uv1,0).xyz * weights.y + 
			texelFetch(norTex,uv2,0).xyz * weights.z;
		srcNormal = normalize(srcNormal);
		
		vec3 dstNormal1 = normalize(dstNormal);
			
		// load normal map and apply it
		if(false && dot(tint,tint) > 0.0){
			
			vec4 srcTangent = 
				texelFetch(tanTex,uv0,0) * weights.x + 
				texelFetch(tanTex,uv1,0) * weights.y + 
				texelFetch(tanTex,uv2,0) * weights.z;
			
			vec3 srcTangent1 = srcTangent.xyz;
			srcTangent1 -= srcNormal * dot(srcNormal,srcTangent1);
			if(dot(srcTangent1,srcTangent1)>0.0) srcTangent1.xyz = normalize(srcTangent1);
			
			vec3 srcBitangent = sign(srcTangent.w) * cross(srcTangent1,srcNormal);
			if(dot(srcBitangent,srcBitangent)>0.0) srcBitangent = normalize(srcBitangent);
			
			vec3 srcNormalMap = (texture(dataTex,srcUV,0.0).xyz*2.0-1.0) * tint.xyz;
			srcNormalMap = normalize(srcNormalMap);
			srcNormal = mat3(-srcBitangent,-srcTangent1,srcNormal) * srcNormalMap;
		}
		
		// transform srcNormal into tangent space
		vec3 dstTangent1 = dstTangent.xyz;
		dstTangent1 -= dstNormal1 * dot(dstNormal1,dstTangent1);
		if(dot(dstTangent1,dstTangent1)>0.0) dstTangent1=normalize(dstTangent1);
		
		vec3 dstBitangent = sign(dstTangent.w) * cross(dstTangent1,dstNormal1);
		if(dot(dstBitangent,dstBitangent)>0.0) dstBitangent=normalize(dstBitangent);
		
		srcNormal = srcNormal * mat3(-dstBitangent,-dstTangent1,dstNormal1);
		float l2 = dot(srcNormal,srcNormal);
		result.xyz = l2>0.0 ? (srcNormal)/sqrt(l2)*.5+.5 : vec3(0.5,0.5,1.0);
		result.a = 1.0;
		
	} else {
		result = texture(dataTex,srcUV,0.0) * tint;
		if(isSingleChannel){
			result = vec4(dot(channelMask,result));
		}
		if(isColor){
			result.rgb = max(1.0549 * pow(result.rgb,vec3(1.0/2.4)) - 0.0549, 0.0);
		}
	}
	
	// result.xyz = vec3(1.0-far*depthScale.x);
	
}`)
}

useGPU = processorUI.value == "0"

function createShader(src,type){
	let vs = type == gl.VERTEX_SHADER
	let sh = gl.createShader(type)
	if(useWebGL2) src = '#version 300 es\n' + src
	else if(vs){
		src = src.split('in ').join('attribute ')
		src = src.split('out ').join('varying ')
	} else {
		src = src.split('in ').join('varying ')
		src = src.split('\nout ').join('\n// out ')
		src = src.split('texture(').join('texture2D(')
		src = '#define result gl_FragColor\n' + src
	}
	gl.shaderSource(sh,src)
	gl.compileShader(sh)
	if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){
		let msg = gl.getShaderInfoLog(sh)
		let lines = src.split('\n')
		for(let i=0;i<lines.length;i++){
			console.log((i+1)+': '+lines[i])
		}
		gl.deleteShader(sh)
		throw msg
	}
	return sh
}

function createProgram(vs,fs){
	vs = createShader(vs,gl.VERTEX_SHADER)
	fs = createShader(fs,gl.FRAGMENT_SHADER)
	let pr = gl.createProgram()
	gl.attachShader(pr,vs)
	gl.attachShader(pr,fs)
	gl.linkProgram(pr)
	if(!gl.getProgramParameter(pr,gl.LINK_STATUS)){
		throw gl.getProgramInfoLog(pr)
	}
	return pr
}

function createBuffer(data,buffer,target){
	buffer = buffer || gl.createBuffer()
	target = target || gl.ARRAY_BUFFER
	gl.bindBuffer(target, buffer)
	gl.bufferData(target, data, gl.STATIC_DRAW)
	return buffer
}

function bindBuffer(ptr,dim,buffer){
	// console.log('binding', ptr, dim, buffer)
	if(ptr < 0) return
	if(buffer){
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
		gl.vertexAttribPointer(ptr, dim, gl.FLOAT, false, 0, 0)
		gl.enableVertexAttribArray(ptr)
	} else {
		gl.disableVertexAttribArray(ptr)
	}
}

let i2fBuffer = new ArrayBuffer(4)
let i2fI = new Uint32Array(i2fBuffer)
let i2fF = new Float32Array(i2fBuffer)

function i2f(v){
	i2fI[0] = v // store as int
	return i2fF[0] // load as float
}

function f2i(v){
	i2fF[0] = v // store as int
	return i2fI[0] // load as float
}

function raytraceOnGPU(glw,glh,src,dst,materials) {
	
	resCanvas2.width = glw
	resCanvas2.height = glh
	
	gl.clearColor(0,0,0,0)
	gl.clearDepth(1.0)

	const locCoords = gl.getAttribLocation(rtShader,'dstCoords')
	const locNormals = gl.getAttribLocation(rtShader,'dstNormals')
	const locUVs = gl.getAttribLocation(rtShader,'dstUVs')
	const locTan = gl.getAttribLocation(rtShader,'dstTangents')

	// keep the shader simple:
	// typically, we will have few src and 1-2 dst objects
	// therefore, we can iterate over them, and handle them individually -> no more texture management stress :)
	
	// console.log(dst)
	// filter dst for materials with UVs
	dst = dst.filter(x => x[1].attributes.uv)
	if(dst.length == 0) {
		alert('No destination meshes with UVs were found');
		return;
	}
	
	function countNodes(node){
		return node.length == 4 ? countNodes(node[1]) + countNodes(node[2]) + 1 : 1
	}
	
	let whiteTex = createTexture({data:new Uint8Array([255,255,255,255]),width:1,height:1})
	
	// src: blas-textures, data texture
	// dst: buffers, normal texture
	
	// general preparation
	gl.disable(gl.BLEND)
	gl.disable(gl.CULL_FACE)
	
	// gl.enable(gl.DEPTH_TEST)
	gl.depthFunc(gl.LESS)
	
	// todo calculate maximum ray-depth by total bounds
	let bounds = [1e38,1e38,1e38,-1e38,-1e38,-1e38]
	src.forEach(srci => {
		let box = srci[1].boundingBox
		let min = box.min, max = box.max
		bounds[0] = Math.min(bounds[0],min.x)
		bounds[1] = Math.min(bounds[1],min.y)
		bounds[2] = Math.min(bounds[2],min.z)
		bounds[3] = Math.max(bounds[3],max.x)
		bounds[4] = Math.max(bounds[4],max.y)
		bounds[5] = Math.max(bounds[5],max.z)
	})
	// console.log('bounds:', bounds)
	let dx = bounds[3]-bounds[0], dy = bounds[4]-bounds[1], dz = bounds[5]-bounds[2]
	let maxDistance = Math.sqrt(dx*dx+dy*dy+dz*dz)
	// console.log(src, maxDistance)
	
	let fb0 = createFramebuffer(glw,glh,true)
	let fb1 = createFramebuffer(glw,glh,false)
	gl.bindFramebuffer(gl.FRAMEBUFFER,fb0.fb)
	
	let isNormalMap = !!layer.isNormalMap
	let dstBuffers = dst.map(dsti => {
		// create all data buffers
		// (src,geoData,materials,isNormalMap,needsUVs,needsTangents)
		let dstData = mergeGeometry([dsti],{},[1],isNormalMap,true,isNormalMap)
		console.log('dsti0', dstData.POSs.length/3, dstData.IDXs.length, dstData)
		
		if(!isNormalMap) {
			// pos -> ray start
			// nor -> ray dir
			// uvs -> uv space position
			// tan -> not needed
			dstData.TANs = null
		}
		
		dstData = unpackGeometryByIndices(dstData)
		
		// correct UVs
		if(true) for(let i=0,uv=dstData.UVSs,l=uv.length;i<l;i+=6){
			let avgU = (uv[i  ]+uv[i+2]+uv[i+4])/3
			let avgV = (uv[i+1]+uv[i+3]+uv[i+5])/3
			let du = Math.floor(avgU)
			let dv = Math.floor(avgV)
			if(du || dv){
				uv[i  ] -= du; uv[i+2] -= du; uv[i+4] -= du;
				uv[i+1] -= dv; uv[i+3] -= dv; uv[i+5] -= dv;
			}
		}
		
		let posBuffer = createBuffer(dstData.POSs)
		let norBuffer = createBuffer(dstData.NORs)
		let uvsBuffer = createBuffer(dstData.UVSs)
		let tanBuffer = isNormalMap ? createBuffer(dstData.TANs) : null
		let length = dstData.POSs.length/3
		console.log('dsti', length)
		return {posBuffer,norBuffer,uvsBuffer,tanBuffer,length}
	})
	
	console.log('rendering', src.length, 'x', dst.length)
	
	gl.viewport(0,0,glw,glh)
	gl.useProgram(rtShader)
	
	// prepare for rendering
	gl.clearColor(0,0,0,0)
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
	
	gl.uniform2f(gl.getUniformLocation(rtShader,'depthScale'), 1.0/maxDistance, maxDistance)
	gl.uniform1i(gl.getUniformLocation(rtShader,'isNormalMap'),layer.isNormalMap?1:0)
	gl.uniform1i(gl.getUniformLocation(rtShader,'isColor'),layer.sRGB?1:0)
	
	for(let srcIndex=0;srcIndex<src.length;srcIndex++){
		
		let srci = src[srcIndex];
		let srcData = mergeGeometry([srci],{},[materials[srcIndex]],isNormalMap,false,false)
		let blas = buildBLAS(srcData.POSs,srcData.IDXs);
		
		const root = blas[0]
		const tris = blas[1]
		
		srcData = unpackGeometryByIndicesV2(srcData,tris);
		
		const numNodes = countNodes(root,0)
		const nodesWidth = Math.ceil(Math.sqrt(numNodes*2)/2)*2
		const nodesHeight = Math.ceil(numNodes*2/nodesWidth)
		const nodeData = new Float32Array(nodesWidth * nodesHeight * 4)
		console.log('#nodes', numNodes, 'wh', nodesWidth, nodesHeight, 'data', nodeData.length)
		let blasPtr = 0
		function collectBLASData(node) {
			let ptr0 = blasPtr;
			let bounds = node[0]
			for(let i=0;i<3;i++) nodeData[blasPtr++] = bounds[i]
			blasPtr++ // here is dim or start index
			for(let i=3;i<6;i++) nodeData[blasPtr++] = bounds[i]
			blasPtr++ // here is next ptr or end index
			if(node.length == 4){
				// branch
				nodeData[ptr0+3] = (node[3]) // dimension
				// handle children
				collectBLASData(node[1])
				nodeData[ptr0+7] = (blasPtr>>3) // write address of second branch: pixel index
				collectBLASData(node[2])
			} else {
				let startIndex = node[1], endIndex = node[2]
				let pos = srcData.POSs
				for(let i=startIndex*3;i<endIndex*3;i++){
					let i3=i*3;
					if(
						pos[i3  ] < bounds[0] || pos[i3  ] > bounds[3] || 
						pos[i3+1] < bounds[1] || pos[i3+1] > bounds[4] ||
						pos[i3+2] < bounds[2] || pos[i3+2] > bounds[5]
					) {
						console.log('illegal (nodeIndex,triIndex,pos,bounds)',blasPtr/8-1,i,[pos[i3],pos[i3+1],pos[i3+2]],bounds)
						// throw 'xxx'
					}
				}
				// leaf, write start and end index
				nodeData[ptr0+3] = (3*(startIndex) + 3) // +3 to mark this as a leaf; slightly shifted start vertex index
				nodeData[ptr0+7] = (3*(endIndex-startIndex)) // length in number of vertices
				// console.log(node,'-blas>',f2i(nodeData[ptr0+3]),f2i(nodeData[ptr0+7]))
				// if(ptr0%256 == 0) console.log(ptr0,nodeData.length,'-blas>',nodeData[ptr0+3],nodeData[ptr0+7])
			}
		}
		collectBLASData(root)
		
		let blasTex = createFPTexture(nodeData, nodesWidth, nodesHeight, 4, 'blas')
		let srcLength = srcData.POSs.length / 3
		let srcWidth = Math.ceil(Math.sqrt(srcLength)/3)*3
		let srcHeight = Math.ceil(srcLength/srcWidth)
		let posTex = createFPTexture(srcData.POSs, srcWidth, srcHeight, 3, 'pos')
		let uvsTex = createFPTexture(srcData.UVSs, srcWidth, srcHeight, 2, 'uvs')
		let norTex = isNormalMap ? createFPTexture(srcData.NORs, srcWidth, srcHeight, 3, 'nor') : null
		let tanTex = isNormalMap ? createFPTexture(srcData.TANs, srcWidth, srcHeight, 4, 'tan') : null
		let mat = materials[srcIndex]
		let dataTex = (mat && mat.image) ? createTexture(mat.image) : whiteTex
		
		console.log('srci', srcLength)
		
		bindTex(dataTex,'dataTex', 5)
		bindTex(blasTex,'blasTex',0)
		bindTex(posTex, 'posTex', 1)
		bindTex(norTex, 'norTex', 2)
		bindTex(uvsTex, 'uvsTex', 3)
		bindTex(tanTex, 'tanTex', 4)
		
		console.log('material:', mat)
		
		let ch = layer.channel
		if(!isNormalMap || (mat && mat.image))
			gl.uniform4f(gl.getUniformLocation(rtShader,'tint'),mat.tint[0],mat.tint[1],mat.tint[2],mat.tint[3])
		else
			gl.uniform4f(gl.getUniformLocation(rtShader,'tint'),0,0,0,0)
		
		gl.uniform4f(gl.getUniformLocation(rtShader,'channelMask'),ch==0?1:0,ch==1?1:0,ch==2?1:0,ch==3?1:0)
		gl.uniform1i(gl.getUniformLocation(rtShader,'isSingleChannel'),ch !== undefined ? 1 : 0)
		
		dstBuffers.forEach(dsti => {
			
			// bind buffers
			bindBuffer(locCoords,3,dsti.posBuffer)
			bindBuffer(locNormals,3,dsti.norBuffer)
			bindBuffer(locUVs,2,dsti.uvsBuffer)
			bindBuffer(locTan,4,dsti.tanBuffer)
			// bind dst normal texture
			bindTex(dsti.normalMap, 'dstNormalMap', 5)
			
			// bind uniforms
			gl.uniform1ui(gl.getUniformLocation(rtShader,'numTris'),srcLength)
			gl.uniform1ui(gl.getUniformLocation(rtShader,'numNodes'),numNodes)
			
			// draw dst
			gl.bindFramebuffer(gl.FRAMEBUFFER,fb0.fb)
			gl.drawArrays(gl.TRIANGLES, 0, dsti.length)
			
		})
		
		// delete all src resources
		gl.deleteTexture(blasTex)
		gl.deleteTexture(posTex)
		gl.deleteTexture(norTex)
		gl.deleteTexture(uvsTex)
		gl.deleteTexture(tanTex)
		
	}

	// delete all dst resources
	dst.forEach(dsti => {
		gl.deleteBuffer(dsti.posBuffer)
		gl.deleteBuffer(dsti.norBuffer)
		gl.deleteBuffer(dsti.uvsBuffer)
		gl.deleteBuffer(dsti.tanBuffer)
		gl.deleteBuffer(dsti.idxBuffer)
		gl.deleteTexture(dsti.normalMap)
	})
	
	gl.disableVertexAttribArray(locCoords)
	gl.disableVertexAttribArray(locNormals)
	gl.disableVertexAttribArray(locUVs)
	gl.deleteTexture(whiteTex)
	
	gl.disable(gl.DEPTH_TEST)
	
	function filtering(sType,clamp){
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, clamp)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, clamp)
		let filtering = sType == gl.UNSIGNED_BYTE ? gl.LINEAR : gl.NEAREST
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering)
	}
	
	function createFramebuffer(w,h,withDepth){
		let fb = gl.createFramebuffer()
		gl.bindFramebuffer(gl.FRAMEBUFFER,fb)
		let tex = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D,tex)
		let iFormat = gl.RGBA, sFormat = gl.RGBA, sType = gl.UNSIGNED_BYTE
		gl.texImage2D(gl.TEXTURE_2D,0,iFormat,w,h,0,sFormat,sType,null)
		filtering(sType,gl.CLAMP_TO_EDGE)
		gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0)
		
		let dtex = null
		if(withDepth){
			dtex = gl.createTexture()
			gl.bindTexture(gl.TEXTURE_2D,dtex)
			iFormat = gl.DEPTH_COMPONENT24, sFormat = gl.DEPTH_COMPONENT, sType = gl.UNSIGNED_INT
			gl.texImage2D(gl.TEXTURE_2D,0,iFormat,w,h,0,sFormat,sType,null)
			filtering(sType,gl.CLAMP_TO_EDGE)
			gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,dtex,0)
		}
		
		let complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
		if(!complete) throw 'framebuffer incomplete'
		return {fb,tex,dtex}
	}
	
	function createTexture(data,tex,iFormat,sFormat,sType){
		// data: ImageData
		tex = tex || gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, tex)
		iFormat = iFormat || gl.RGBA
		sFormat = sFormat || gl.RGBA
		sType = sType || gl.UNSIGNED_BYTE
		gl.texImage2D(gl.TEXTURE_2D,0,iFormat,data.width,data.height,0,sFormat,sType,data.data)
		filtering(sType,gl.REPEAT)
		return tex
	}
	
	function createFPTexture(data,width,height,c,name) {
		console.log('fp-tex:', width, height, c, name)
		// copy data, if we need padding
		let size = width * height * c
		if(!data || size > data.length){
			let newData = new Float32Array(size)
			if(data) newData.set(data) // thank you, ChatGPT :D
			data = newData
		}
		let iFormat = [gl.R32F,gl.RG32F,gl.RGB32F,gl.RGBA32F][c-1]
		let sFormat = [gl.RED,gl.RG,gl.RGB,gl.RGBA][c-1]
		return createTexture({data, width, height}, null, iFormat, sFormat, gl.FLOAT)
	}
	
	function displayTex(tex) {
		gl.activeTexture(gl.TEXTURE0)
		gl.clearColor(0,0,0,0)
		gl.clear(gl.COLOR_BUFFER_BIT)
		gl.useProgram(flatShader)
		gl.bindTexture(gl.TEXTURE_2D,tex)
		bindBuffer(flatLoc,2,flatBuffer)
		gl.drawArrays(gl.TRIANGLES, 0, 3)
	}
	
	gl.putImageData = function(img) {
		let tex = createTexture(img)
		displayTex(tex)
		gl.deleteTexture(tex)
	}
	
	// blasTex, posTex, norTex, uvsTex
	function bindTex(tex,name,idx){
		let loc = gl.getUniformLocation(rtShader,name)
		if(loc){
			if(idx) gl.uniform1i(loc,idx)
			gl.activeTexture(gl.TEXTURE0 + idx)
			gl.bindTexture(gl.TEXTURE_2D,tex)
			// console.log('bound ' + name + ' :)')
		}// else console.log('missing ' + name, tex, idx)
	}
	
	// spread image on GPU as well :), should be much faster
	
	
	const pixels = new Uint8ClampedArray(glw*glh*4)
	gl.readPixels(0,0,glw,glh,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
	
	let hasData = false
	if(1) for(let j=3,k=pixels.length;j<k;j+=4){
		if(pixels[j] > 0){
			hasData = true
			break
		}
	}
	
	if(hasData) {
		
		gl.useProgram(spreadShader)
		gl.activeTexture(gl.TEXTURE0)
		let spreadFactor = 1 // 1: good, 1.5: fast
		gl.uniform2f(gl.getUniformLocation(spreadShader,'duv'), spreadFactor/glw,spreadFactor/glh)
		bindBuffer(gl.getAttribLocation(spreadShader,'uvs'),2,flatBuffer)
		
		let maxIterations = spreadFactor == 1 ? glw / 2.5 : glw / 4
		let testPeriod = Math.min(64, maxIterations)
		let testMask = testPeriod-1
		maxIterations -= maxIterations % testPeriod
		for(let i=0;i<maxIterations;i++){
			gl.bindFramebuffer(gl.FRAMEBUFFER,(i&1?fb0:fb1).fb)
			gl.bindTexture(gl.TEXTURE_2D,(i&1?fb1:fb0).tex)
			gl.drawArrays(gl.TRIANGLES,0,3)
			if((i & testMask) == testMask) {
				gl.readPixels(0,0,glw,glh,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
				let hasMissingPixel = false
				for(let j=3,k=pixels.length;j<k;j+=4){
					if(pixels[j] == 0){
						hasMissingPixel = true
						break
					}
				}
				console.log('spreading',i,'/',maxIterations)
				if(!hasMissingPixel) break
			}
		}
	}
	
	
	gl.bindFramebuffer(gl.FRAMEBUFFER,null)
	displayTex(fb0.tex)
	
	gl.deleteFramebuffer(fb0.fb)
	gl.deleteFramebuffer(fb1.fb)
	gl.deleteTexture(fb0.tex)
	gl.deleteTexture(fb1.tex)
	
	// flip result upside down
	let stride = glw*4
	let row = new Uint8Array(stride)
	for(let y0=0,y1=glh-1;y0<y1;y0++,y1--){
		let i0=y0*stride, i1=y1*stride;
		row.set(pixels.subarray(i1,i1+stride),0) // row = i1
		pixels.set(pixels.subarray(i0,i0+stride),i1) // i1 = i0
		pixels.set(row,i0) // i0 = row
	}
	
	return new ImageData(pixels,glw,glh)

}
