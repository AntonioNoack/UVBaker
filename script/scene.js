
import * as THREE from 'three'
import { OrbitControls } from 'three/controls/OrbitControls.js'
import { EffectComposer } from 'three/postprocessing/EffectComposer.js'
import { TAARenderPass } from 'three/postprocessing/TAARenderPass.js'
import { Loader } from 'script/mesh-loader.js'

window.THREE = THREE

function create(div,idx,extra){
	
	const models = []

	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(75, extra.w/(3*extra.h), 0.1, 1000)

	const renderer = window.renderer = new THREE.WebGLRenderer({ alpha: true })
	renderer.setSize(extra.w*0.326, extra.h)
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
	extra.controls2.push(controls)
	
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
		extra.renderers.push(composer)
	} else {
		extra.renderers.push(renderer)
	}
	extra.renderers2.push(renderer)
	extra.cameras.push(camera)
	extra.scenes.push(scene)
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

function loadReflectionMap(scenes){
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
}

export { create, splitByMaterial, collectData, camSetup, loadReflectionMap };
