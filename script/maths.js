
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

function mix2d(v00,v01,v10,v11,fx,fy){
	let gx = 1-fx, gy = 1-fy
	return (v00*gy+fy*v01)*gx+fx*(v10*gy+fy*v11)
}

export { random, clamp, mix2d };
