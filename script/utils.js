
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

export { finishTexture };
