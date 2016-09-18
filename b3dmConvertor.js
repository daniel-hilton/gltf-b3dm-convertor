"use strict";

const path = require('path');
const spawn = require('child_process').spawn;
const fs = require('fs');
const Promise = require('bluebird');
const Cesium = require('cesium');

const readFile = Promise.promisify(fs.readFile);
const writeFile = Promise.promisify(fs.writeFile);
const deleteFile = Promise.promisify(fs.unlink);
const copyFile = Promise.promisify(fs.link);

var tempCartesian3 = new Cesium.Cartesian3();

const base64Regexp = /^data:.*?;base64,/;
const BUFFER_NAME = 'KHR_binary_glTF'; //  argv.cesium ? 'KHR_binary_glTF' : 'binary_glTF';

// todo delete files

function promiseFromProcess(process) {
    return new Promise(function (resolve, reject) {
        var output = "";
        process.addListener('error', reject);
        process.addListener('exit', function (code) {
            if (code === 0) {
                resolve(output)
            } else {
                console.log(output);// todo remove
                reject(output);
            }
        });
        process.stdout.on("data", function (data) {
            output = output + data.toString();
        });
        process.stderr.on("data", function (data) {
            output = output + data.toString();
        });
    })
}

function deleteWhenDone() {
    let allDeletedPromises = [];
    this.deleteOnEnd.forEach(path => allDeletedPromises.push(deleteFile(path)))
    return Promise.all(allDeletedPromises);
}

function fixDae() {
    let daePath = this.originalFilePath;
    let newDaePath = this.daeFilePath;
    let deleteOnEnd = this.deleteOnEnd;

    return readFile(daePath)
        .then(function (data) {
            let content = data.toString();
            let tagStart = content.indexOf("<image ");
            let tagEnd = content.indexOf("</image>") + 8;
            let assetEnd = content.indexOf("</asset>") + 8;
            let imageTag = "<library_images>" + content.substr(tagStart, tagEnd - tagStart) + "</library_images>";
            // splicing the unwanted part
            content = content.substr(0, tagStart) + content.substr(tagEnd);
            // pushing it in the new position
            content = content.substr(0, assetEnd) + imageTag + content.substr(assetEnd);

            //extracting imageUrl
            let urlStart = imageTag.indexOf("<init_from>") + 11;
            let urlEnd = imageTag.indexOf("</init_from>");
            let imageUrl = imageTag.substr(urlStart, urlEnd - urlStart).trim();

            if (tagStart == -1 || urlEnd == -1) {
                throw new Error("Empty File");
            }

            let currentImagePath = path.join(path.dirname(daePath), imageUrl);
            let newImagePath = path.join(path.dirname(newDaePath), imageUrl);

            deleteOnEnd.push(newImagePath);

            return Promise.all([
                writeFile(newDaePath, content),
                copyFile(currentImagePath, newImagePath)
            ]);
        })
}

function b3dmConvertor(JobManager) {
    const that = this;
    this.JobManager = JobManager;
    this.promise = new Promise(function (resolve) {
        that.resolvePromise = resolve;
    });
    this.getNewJob();
    //return that.promise;
}

function addPointToExtent(point, extent) {
    if (point.x > extent.east) {
        extent.east = point.x;
    }
    if (point.x < extent.west) {
        extent.west = point.x;
    }
    if (point.y > extent.north) {
        extent.north = point.y;
    }
    if (point.y < extent.south) {
        extent.south = point.y;
    }
    if (point.z < extent.bottom) {
        extent.bottom = point.z;
    }
    if (point.z > extent.top) {
        extent.top = point.z;
    }
}

function getExtentByDegree(){
    let transformMatrix = this.transformMatrix;
    let extent = this.extent;
    let northEastTop = new Cesium.Cartesian3(extent.east,extent.north,extent.top);
    let southWestBottom = new Cesium.Cartesian3(extent.west,extent.south,extent.bottom);

    Cesium.Matrix4.multiplyByPoint(transformMatrix, northEastTop, northEastTop);
    Cesium.Matrix4.multiplyByPoint(transformMatrix, southWestBottom, southWestBottom);

    let corner1 = Cesium.Cartographic.fromCartesian(northEastTop);
    let corner2 = Cesium.Cartographic.fromCartesian(southWestBottom);

    return{
        west: Math.min(corner1.longitude,corner2.longitude),
        east: Math.max(corner1.longitude,corner2.longitude),
        north: Math.max(corner1.latitude,corner2.latitude),
        south: Math.min(corner1.latitude,corner2.latitude),
        top: Math.max(corner1.height,corner2.height),
        bottom:  Math.min(corner1.height,corner2.height)
    }
}


// todo rename
function fixPositionBuffer(buffer, offset, count, centerRtc,transformMatrix, currentExtent) {
    for (let i = 0; i < count; i++) {
        tempCartesian3.x = buffer.readFloatLE(12 * i + offset);
        tempCartesian3.y = buffer.readFloatLE(12 * i + offset + 4);
        tempCartesian3.z = buffer.readFloatLE(12 * i + offset + 8);
		
        addPointToExtent(tempCartesian3,currentExtent);

        Cesium.Matrix4.multiplyByPoint(transformMatrix, tempCartesian3, tempCartesian3);//console.log(tempCartesian3);
        Cesium.Cartesian3.subtract(tempCartesian3, centerRtc, tempCartesian3);

        buffer.writeFloatLE(tempCartesian3.x, 12 * i + offset);
        buffer.writeFloatLE(tempCartesian3.y, 12 * i + offset + 4);
        buffer.writeFloatLE(tempCartesian3.z, 12 * i + offset + 8);
    }
}

function createSceneRtcExtention() {
    if (!this.isB3dm) {
        return;
    }
    var scene = this.scene;
    var rtc = this.centerRtc;

    if (!Array.isArray(scene.extensionsUsed)) {
        scene.extensionsUsed = [];
    }
    scene.extensionsUsed.push('CESIUM_RTC');

    if (!scene.extensions) {
        scene.extensions = {}
    }
    scene.extensions["CESIUM_RTC"] = {
        center: [rtc.x, rtc.y, rtc.z]
    };
    return scene;
}

function createTechniqueRtc() {
    var scene = this.scene
    if (!this.isB3dm) {
        return;
    }
    if (!scene.techniques) {
        console.error("No techniques attribute! ")
    }
    for (let techniqueId in scene.techniques) {
        var technique = scene.techniques[techniqueId];
		let addAttributesTo = technique;
		
		if(technique.pass){
			console.log("using pass instead of technique: ", technique.pass)
			addAttributesTo = technique.passes[technique.pass].instanceProgram
		}
		
        if (!technique.parameters) {
            technique.parameters = {};
        }
        technique.parameters.modelViewMatrix = {
            semantic: "CESIUM_RTC_MODELVIEW",
            type: 35676
        };
        technique.parameters.batchId = {
            semantic: "BATCHID",
            type: 5123
        };

        if (!addAttributesTo.attributes) {
            addAttributesTo.attributes = {};
        }
		if(addAttributesTo.attributes["a_batchId"]){
			console.log("attributes.a_batchId exists")
		}
        addAttributesTo.attributes["a_batchId"] = "batchId";
    }
}

function createSceneBatch() {
    let vertexShaders = this.vertexShaders;
    var scene = this.scene;
    if (!this.isB3dm) {
        return;
    }
    if (!scene.programs) {
        throw  new Error("No programs attribute! ");
    }
    for (let programId in scene.programs) {
        let program = scene.programs[programId];
        if (!program.attributes || !program.attributes.push) {
            console.error("No program.attributes! ");
            program.attributes = [];
        }
        program.attributes.push("a_batchId");

        vertexShaders[program.vertexShader] = true;
    }
}

function createMeshBatch() {
    var scene = this.scene;
    var appendToBufferArray = this.appendToBufferArray;
    if (!this.isB3dm) {
        return;
    }
    if (!scene.meshes) {
        throw new Error("No meshes attribute! ");
    }
    for (let meshId in scene.meshes) {
        var mesh = scene.meshes[meshId];
        if (!mesh.primitives || !mesh.primitives[0]) {
            console.error("no primitives!");
            continue;
        }
        if (mesh.primitives.length !== 1) {
            console.error("more than one primitive!");
            continue;
        }
        let primitive = mesh.primitives[0];

        if (!primitive.attributes || !primitive.attributes.POSITION) {
            console.error("no primitive.attributes.POSITION");
            continue;
        }

        var accessorLength = scene.accessors[primitive.attributes.POSITION].count;
        var accessorName = "accessor_batchId_" + meshId;
        var bufferViewName = scene.accessors[primitive.attributes.POSITION].bufferView;
        var bufferView = scene.bufferViews[bufferViewName];

        primitive.attributes["BATCHID"] = accessorName;

        let offset = bufferView.byteLength;
        let accessorByteLength = accessorLength * 2;
        bufferView.byteLength += accessorByteLength;

        var batchIdBuffer = new Buffer(accessorByteLength);
        batchIdBuffer.forEach((dat, ind) => batchIdBuffer[ind] = 0);

        if (bufferView.buffer in appendToBufferArray) {
            appendToBufferArray[bufferView.buffer].push(batchIdBuffer)
        } else {
            appendToBufferArray[bufferView.buffer] = [batchIdBuffer]
        }

        scene.accessors[accessorName] = {
            bufferView: bufferViewName,
            byteOffset: offset,
            byteStride: 0,// WEIRDDD : should be 2
            componentType: 5123,
            count: accessorLength,
            max: [0],
            min: [0],
            type: "SCALAR"
        };

    }
}

function addToBody(data, name, that) {

    let vertexShaders = that.vertexShaders;
    let bodyParts = that.bodyParts;
    let appendToBufferArray = that.appendToBufferArray;

    let promise;
    // Base64 data
    if (data.startsWith('data:')) {
        if (!base64Regexp.test(data)){
            throw new Error('unsupported data URI');
        }
        promise = Promise.resolve(new Buffer(data.replace(base64Regexp, ''), 'base64'));
    }
    // Buffer
    else if (data instanceof Buffer) {
        promise = Promise.resolve(data);
    }
    // Uri to file
    else {
        let containingFolder = path.dirname(that.gltfFilePath);
        promise = readFile(path.join(containingFolder , data));
    }

    return promise.then(function (contents) {

        if (name && appendToBufferArray[name]) {
            contents = Buffer.concat([contents].concat(appendToBufferArray[name]));
        }
        // Addidng attr.... todo
        if (name && vertexShaders[name]) {
            let contentsStr = contents.toString();
            let firstAtrribudeIdx = contentsStr.indexOf('attribute');
            contentsStr = contentsStr.substr(0, firstAtrribudeIdx) + "attribute float a_batchId;\r\n" + contentsStr.substr(firstAtrribudeIdx)
            contents = new Buffer(contentsStr);
        }

        const offset = that.bodyLength;
        bodyParts.push(offset, contents);
        const length = contents.length;
        that.bodyLength += length;
        return {offset, length, contents};
    });
}

function convertToB3dm() {
    let transformMatrix = this.transformMatrix;
    let newPath = this.b3dmFilePath;
    let scene = this.scene;
    let isB3dm = this.isB3dm;
    let bodyParts = this.bodyParts;
    let centerRtc = this.centerRtc;
    let extent = this.extent;
    let that = this;

    if (!Array.isArray(scene.extensionsUsed)) {
        scene.extensionsUsed = [];
    }
    scene.extensionsUsed.push('KHR_binary_glTF');

    var positionBuffers = Object.keys(scene.meshes)
        .map(mesh => scene.meshes[mesh].primitives[0].attributes.POSITION)
        .map(accessorName => scene.accessors[accessorName])
        .map(accessor => {
            return {
                name: scene.bufferViews[accessor.bufferView].buffer,
                offset: accessor.byteOffset + scene.bufferViews[accessor.bufferView].byteOffset,
                count: accessor.count
            }
        });
    const bufferPromises = [];
    Object.keys(scene.buffers).forEach(function (bufferId) {
        const buffer = scene.buffers[bufferId];

        // We don't know how to deal with other types of buffers yet.
        const type = buffer.type;
        if (type && type !== 'arraybuffer') {
            throw new Error(path.format('buffer type "%s" not supported: %s', type, bufferId));
        }

        const promise = addToBody(buffer.uri, bufferId, that).then(function (obj) {
            // Set the buffer value to the offset temporarily for easier manipulation of bufferViews.
            buffer.byteOffset = obj.offset;

            if (isB3dm) {
                positionBuffers.filter(buffer => buffer.name == bufferId)
                    .forEach(buffer => fixPositionBuffer(obj.contents, buffer.offset, buffer.count, centerRtc,transformMatrix,extent))
            }

        });

        bufferPromises.push(promise);
    });

    // Run this on the existing buffers first so that the buffer view code can read from it.
    return Promise.all(bufferPromises)
        .return(scene)
        .then(function (scene) {
            Object.keys(scene.bufferViews).forEach(function (bufferViewId) {
                const bufferView = scene.bufferViews[bufferViewId];
                const bufferId = bufferView.buffer;
                const referencedBuffer = scene.buffers[bufferId];

                if (!referencedBuffer) {
                    throw new Error(path.format('buffer ID reference not found: %s', bufferId));
                }

                bufferView.buffer = BUFFER_NAME;
                bufferView.byteOffset += referencedBuffer.byteOffset;


            });

            const promises = [];
            Object.keys(scene.shaders).forEach(function (shaderId) {
                const shader = scene.shaders[shaderId];
                const uri = shader.uri;
                shader.uri = '';

                const promise = addToBody(uri, shaderId, that).then(function (obj) {
                    const bufferViewId = 'binary_shader_' + shaderId;
                    shader.extensions = {KHR_binary_glTF: {bufferView: bufferViewId}};

                    scene.bufferViews[bufferViewId] =
                    {
                        buffer: BUFFER_NAME
                        , byteLength: obj.length
                        , byteOffset: obj.offset
                    };
                });

                promises.push(promise);
            });

            Object.keys(scene.images).forEach(function (imageId) {
                const image = scene.images[imageId];
                const uri = image.uri;

                const promise = addToBody(uri, imageId, that).then(function (obj) {
                    const bufferViewId = 'binary_images_' + imageId;
                    // TODO: add extension properties
                    image.extensions =
                    {
                        KHR_binary_glTF: {
                            bufferView: bufferViewId,
                            mimeType: 'image/jpg',
                            height: 9999,
                            width: 9999
                        }
                    };

                    scene.bufferViews[bufferViewId] = {
                        buffer: BUFFER_NAME,
                        byteLength: obj.length,
                        byteOffset: obj.offset
                    };
                });

                promises.push(promise);
            });

            return Promise.all(promises).return(scene);
        }).then(function (scene) {
            // All buffer views now reference the implicit "binary_glTF" buffer, so it is no longer needed.
            scene.buffers = {
                KHR_binary_glTF: {
                    "type": "arraybuffer",
                    uri: 'data:,',
                    byteLength: that.bodyLength
                }
            };

            const newSceneStr = JSON.stringify(scene);
            const sceneLength = Buffer.byteLength(newSceneStr);
            // As body is 4-byte aligned, the scene length must be padded to have a multiple of 4.
            // jshint bitwise:false
            const paddedSceneLength = (sceneLength + 3) & ~3;
            // jshint bitwise:true

            // Header is 20 bytes long.
            const bodyOffset = paddedSceneLength + 20;
            const fileLength = bodyOffset + that.bodyLength;

            var b3dmOffset = isB3dm ? 24 : 0;

            // Let's create our GLB file!
            const glbFile = new Buffer(fileLength + b3dmOffset);


            if (isB3dm) {
                // B3DM headers :
                // Magic number (the ASCII string 'glTF').
                glbFile.writeUInt32BE(0x6233646d, 0);
                // Binary GLTF is little endian.
                glbFile.writeUInt32LE(1, 4); // VERSION
                glbFile.writeUInt32LE(fileLength + b3dmOffset, 8); //  byteLength
                glbFile.writeUInt32LE(0, 12); // batchTableJSONByteLength
                glbFile.writeUInt32LE(0, 16); // batchTableBinaryByteLength
                glbFile.writeUInt32LE(1, 20); // models in batch
            }

            // Magic number (the ASCII string 'glTF').
            glbFile.writeUInt32BE(0x676C5446, 0 + b3dmOffset);

            // Binary GLTF is little endian.
            // Version of the Binary glTF container format as a uint32 (vesrion 1).
            glbFile.writeUInt32LE(1, 4 + b3dmOffset);

            // Total length of the generated file in bytes (uint32).
            glbFile.writeUInt32LE(fileLength, 8 + b3dmOffset);

            // Total length of the scene in bytes (uint32).
            glbFile.writeUInt32LE(paddedSceneLength, 12 + b3dmOffset);

            // Scene format as a uint32 (JSON is 0).
            glbFile.writeUInt32LE(0, 16 + b3dmOffset);

            // Write the scene.
            glbFile.write(newSceneStr, 20 + b3dmOffset);

            // Add spaces as padding to ensure scene is a multiple of 4 bytes.
            for (let i = sceneLength + 20; i < bodyOffset; ++i) glbFile[i + b3dmOffset] = 0x20;

            // Write the body.
            for (let i = 0; i < bodyParts.length; i += 2) {
                const offset = bodyParts[i];
                const contents = bodyParts[i + 1];
                contents.copy(glbFile, bodyOffset + offset + b3dmOffset);
            }

            //console.log("done: " + newPath);
            return writeFile(newPath, glbFile);
        })
}

b3dmConvertor.prototype.getNewJob = function () {// todo resolve if done
    var jobManger = this.JobManager;

    if (jobManger.nextIndex >= jobManger.allFiles.length) {
        this.resolvePromise();
        return;
    }
	let isB3dm = true
    let that = this;
    let originalFilePath = jobManger.allFiles[jobManger.nextIndex++];
    let daeFilePath = path.join(jobManger.basePath, "Input", path.basename(originalFilePath)); //.replace('+', '').replace('+', '').replace('+', '')
    let gltfFilePath = daeFilePath.replace('.gltf', '.gltf');
    let b3dmFilePath = daeFilePath.replace('.gltf', '.b3dm').replace("Input", "Output");

    let inf = Number.MAX_VALUE;
    
	if(!isB3dm){ 
		b3dmFilePath = b3dmFilePath.replace('.b3dm', '.glb')
	}
	
    let jobData = {
        originalFilePath,
        daeFilePath,
        b3dmFilePath,
        gltfFilePath,
        bodyLength: 0,
        bodyParts: [],
        isB3dm,
        scene: null,
        appendToBufferArray: {},
        centerRtc: jobManger.rtcCenter,
        transformMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(jobManger.rtcCenter),
        vertexShaders: {},
        deleteOnEnd: [],
        extent: {west: inf, east: -inf, north: -inf, south: inf, top: -inf, bottom: inf}
    };
	

    Promise.bind(jobData)
      //  .then(fixDae)
      //  .then(() => jobData.deleteOnEnd.push(daeFilePath))
      //  .then(() => promiseFromProcess(spawn('dae2gltf\\collada2gltf.exe', ['-e', '-f', daeFilePath, '-o', gltfFilePath, '-m', '"binary"'])))
      //  .then(() => jobData.deleteOnEnd.push(gltfFilePath))
        .then(() => readFile(gltfFilePath, 'utf-8'))
        .then(gltf => jobData.scene = JSON.parse(gltf))
        .then(createMeshBatch)
        .then(createSceneRtcExtention)
        .then(createTechniqueRtc)
        .then(createSceneBatch)
        .then(convertToB3dm)
        .then(() => console.log(b3dmFilePath))
        .then(getExtentByDegree)
        .then(degreeExtent => jobManger.doneFiles.push({path:b3dmFilePath,extent:degreeExtent}))
        .catch(err => {
            console.log("failed converting " + originalFilePath);
            if (err.message == "Empty File") {
                jobManger.emptyFiles.push(originalFilePath)
            } else {
                console.error(err);
                jobManger.failedFiles.push(originalFilePath)
            }
        })
        .then(deleteWhenDone)
        .catch(err => console.error(err))
        .then(() => that.getNewJob());
};

exports.createConvertor = function (JobManager) {
    return new b3dmConvertor(JobManager);
}