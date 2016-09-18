let Cesium = require("Cesium");
const fs = require('fs')
const Promise = require('bluebird')
const path = require('path')

let b3dmConvertor = require("./b3dmConvertor");
let tilesetBuilder = require("./tilesetBuilder");

const readFile = Promise.promisify(fs.readFile)
const writeFile = Promise.promisify(fs.writeFile)

//[2.82519, 41.9874, -50]


let dirName = "C:/DEL/kirona"
let tilesetPath = dirName +  "/Output/tileset.json"
let JobsConfig = {
	basePath: dirName,
	parallelJobs: 1,
	processors: [],
	allFiles: [],
	emptyFiles: [],
	failedFiles: [],
	doneFiles: [],
	nextIndex: 0,
	rtcCenter: Cesium.Cartesian3.fromDegrees(2.82519, 41.9874, -50)
}

readFile(path.join(dirName,"Input/allFiles.txt"))
	.then(JSON.parse)
	.then(function(allFiles){
		allFiles = allFiles//.slice(0,1)
		console.log(allFiles)
		JobsConfig.allFiles = allFiles;
		
		while(JobsConfig.processors.length < JobsConfig.parallelJobs){
			JobsConfig.processors.push(b3dmConvertor.createConvertor(JobsConfig));
		}
		return Promise.all(JobsConfig.processors.map(p => p.promise))
	})
	.then(() => console.log("done:" + JobsConfig.doneFiles.length))
	.then(() => console.log("failedFiles:" + JobsConfig.failedFiles.length))
	.then(() => tilesetBuilder.build(JobsConfig.doneFiles))
	.then(tileset => writeFile(tilesetPath, JSON.stringify(tileset,null,2)))
	;