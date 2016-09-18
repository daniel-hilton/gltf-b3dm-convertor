'use strict';

const path = require('path');

const fs = require('fs');
// constants
const Promise = require('bluebird');
const Cesium = require('Cesium');
const writeFile = Promise.promisify(fs.writeFile);

function setMetadata(files){
	files.forEach(file => {
		// File Path: "Tile_000_000_l21_003212"
		let nameParts = path.basename(file.path).split(".")[0].split("_");
		file.x = parseInt(nameParts[1]);
		file.y = parseInt(nameParts[2]);
		file.level = parseInt(nameParts[3].substr(1));
		file.tile = nameParts[4] || "";
	})
}

function mergeExtents(ext1,ext2){
	return {
		west: Math.min(ext1.west,ext2.west),
		east: Math.max(ext1.east,ext2.east),
		south: Math.min(ext1.south,ext2.south),
		north: Math.max(ext1.north,ext2.north),
		bottom: Math.min(ext1.bottom,ext2.bottom),
		top: Math.max(ext1.top,ext2.top)
	};
}

function createBoundingBoxArray(extent){
	return {
		//
		region: [extent.west, extent.south,extent.east, extent.north,extent.bottom, extent.top]
	};
}

function getTileTree(files,tile,geometricError,transformMatrixArray) {
	// let children = 
	//
	//
	//
	//
	//
	
	return {
		boundingVolume: createBoundingBoxArray(tile.extent),
		geometricError, geometricError,
		content: {
			url: path.basename(tile.path)
		},
		refine: "replace",
		// transform: transformMatrixArray,
		children: [] // children.map(child => getTileTree(files,child,geometricError/2,transformMatrixArray))
	};
}

function buildTileset(files,wgsCoords){
	//
	//
	//
	//
	//
	let geometricError = 1200;
	// write file.. todo
	setMetadata(files);
	let topTiles = files // because cuurently we dont have LOD
	
	// fixing the issue that parent tile is smaller that the children 
	// todo copy
	
	return {
		asset: {
			version: "0.0"
		},
		refine: "replace",
		geometricError: geometricError,
		root: {
			boundingVolume: createBoundingBoxArray(topTiles.map(tile => tile.extent).reduce(mergeExtents)),
			geometricError: geometricError,
			refine: "replace",
			children: topTiles.map(tile => getTileTree(files, tile,geometricError,null))
		}
	}
}

exports.build = buildTileset