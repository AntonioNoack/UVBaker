# UVBaker
Transfer normals, diffuse, metallic, and roughness from high-poly meshes onto low-poly meshes (given UVs)

## Problem statement
You have a high-poly mesh, but it's too slow for real-time rendering.
So you generate a low-poly mesh, and UVs for it. Then you want to bake normals,
but it's awfully slow in Blender.

## Solution
I don't understand why Blender is so slow, so I wanted to prove I can implement something much faster in single-threaded JavaScript, than Blender's C++ solution.
This is the result, and most times indeed, it's much much faster.

## Try It
I've hosted the project on [https://phychi.com/uvbaker](https://phychi.com/uvbaker).