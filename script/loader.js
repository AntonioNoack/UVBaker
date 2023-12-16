
import { clamp, mix2d } from 'script/maths.js'

const images = {}

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

export { loadMaterials };
