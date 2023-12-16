
import { buildBLAS, maxNodeSize, TRIS_ABC_IDX } from 'script/rtas.js'
import { mergeGeometry, unpackGeometryByIndices, unpackGeometryByIndicesV2 } from 'script/geometry.js'

let gl = null
let flatBuffer = null
let flatShader = null
let flatLoc = 0
let spreadShader = null
let rtShader = null

function prepareGPU(){
	gl = resCtx2
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

function raytraceOnGPU(glw,glh,src,dst,materials) {
	
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

export { prepareGPU, raytraceOnGPU };
