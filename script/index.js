
// src: build acceleration structure
// dst: raytrace respective data from pos+dir, onto uv, and project it

import * as THREE from 'three'
import { Loader } from 'script/mesh-loader.js'
import { loadMaterials } from 'script/loader.js'
import { create, collectData, camSetup, loadReflectionMap } from 'script/scene.js'
import { raytraceOnCPU } from 'script/raytrace-on-cpu.js'
import { raytraceOnGPU, prepareGPU } from 'script/raytrace-on-gpu.js'
import { finishTexture } from 'script/utils.js'

// GPU path isn't working yet
window.useGPU = true
window.useWebGL2 = true

// useGPU ? 'MetallicSphere1.glb' : 'cube.obj' //'cube gradient.glb'
const file0 = 'cube.obj'
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
window.displayMat0 = new THREE.MeshStandardMaterial()
window.displayMat1 = new THREE.MeshPhongMaterial()
window.displayMat = displayMat1

let extra1 = {w,h,controls2,renderers,renderers2,cameras,scenes}
const srcModels = create(divSrc,0,extra1)
const dstModels = create(divDst,1,extra1)
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
	// todo can we make this only render when we need it?
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

window.resCtx1 = resCanvas1.getContext('2d', { antialias: false })
window.resCtx2 = resCanvas2.getContext(useWebGL2 ? 'webgl2' : 'webgl')
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

window.layer = layers[0]
layersUI.onchange = function(){
	let newLayer = layers[layersUI.value*1]
	if(newLayer != layer){
		layer = newLayer
		matList = null
	}
}

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

window.session = 0

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

window.blas = null
window.matList = null
window.srcGeoData = {}
window.dstGeoData = {}

function bake1(materials,thisSession) {
	let lastTime = startTime
	console.log(-lastTime+(lastTime=Date.now()), 'collecting materials, gpu?', useGPU)
	
	const w = resolutionUI.value*1, h = w
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
		raytraceOnCPU(w,h,src,dst,materials,thisSession,startTime,lastTime);
	}
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

loadReflectionMap(scenes)

if(useGPU) {
	prepareGPU()
}

useGPU = processorUI.value == "0"
