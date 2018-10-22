'use strict';

require('dotenv').config();

const Datastore = require('@google-cloud/datastore');
const automl = require('@google-cloud/automl').v1beta1;
const express = require('express');
const multer = require('multer');
var PropertiesReader = require('properties-reader');
var foodMapping = PropertiesReader('./data/food_mapping.txt');

// Parameter setting
const FILE_UPLOAD_MAX_SIZE = process.env.FILE_UPLOAD_MAX_SIZE ? process.env.FILE_UPLOAD_MAX_SIZE : 5242880;
const PROJECT_ID = process.env.GCLOUD_PROJECT ? process.env.GCLOUD_PROJECT : process.env.PROJECT_ID; 
const REGION_NAME = process.env.REGION_NAME ? process.env.REGION_NAME : process.env.COMPUTE_REGION;
const MODEL_ID = process.env.MODEL_ID; 
const SCORE_THRESHOLD = process.env.SCORE_THRESHOLD ? process.env.SCORE_THRESHOLD : "0.5";
const APP_NAME = process.env.APP_NAME ? process.env.APP_NAME : "WhatAmIEating";

var storage = multer.memoryStorage();
var upload = multer({
	storage: storage,
	limits: {
		fileSize: FILE_UPLOAD_MAX_SIZE
	},
});

const datastoreClient = new Datastore({});
const predictServiceClient = new automl.PredictionServiceClient();

const app = express();
app.use('/', express.static('web'));
app.post('/upload', upload.single('photo'), function (req, res, next) {

	console.log("===============================================")
	console.log("Incoming file upload " + req.file.buffer.length + " bytes");
	console.log("===============================================")

	let logEvent = {
		ip: req.ip.substr(7),
		initTime: new Date().toJSON(),
		size : req.file.buffer.length,
	};

	// Connect to GCP Prediction Service
	const modelFullId = predictServiceClient.modelPath(PROJECT_ID, REGION_NAME, MODEL_ID);

	// Read the file content for prediction.
	const content = req.file.buffer; 
	const params = {};
	params.score_threshold = SCORE_THRESHOLD;

	// Set the payload by giving the content and type of the file.
	const payload = {};
	payload.image = {
		imageBytes: content
	};

	console.log("Trigger Prediction", PROJECT_ID, REGION_NAME, MODEL_ID, SCORE_THRESHOLD);

	predictServiceClient
		.predict({
			name: modelFullId,
			payload: payload,
			params: params
		})
		.then(responses => {
			console.log(`Prediction results:`);
			var result = "";
			for (var i = 0; i < responses[0].payload.length; i++) {
				var item = responses[0].payload[i];
				var score = (item.classification.score * 100).toFixed(4);
				var foodDetail = getFoodDetail(item);
				result += `Result :  ${foodDetail.displayName} <br/> Score : ${score}% <br/> Calories : ${foodDetail.calories} <br/> Recommendation : ${foodDetail.recommendation}`;
			}
			if (result === "") result = "Unable to detect this object. What is it ?";
			console.log(result);
			res.end(result);

			logEvent.desc = result;
		})
		.catch(err => {
			console.error(err);
			logEvent.desc = err;
		})
		.then(() => {
			logEvent.compTime = new Date().toJSON();
			addEvent(logEvent);
		});

});

function getFoodDetail(item) {
	var detail = {};
	var tmp = foodMapping.get(item.displayName);
	if (tmp == null)
	{
		detail.displayName = item.displayName;
		detail.calories = 100;
		detail.recommendation = "Eat";
	}
	else{
		detail.displayName = tmp.split(",")[0];
		detail.calories = tmp.split(",")[1];
		detail.recommendation = tmp.split(",")[2];
	}
	return detail;
}

function addEvent(data) {
	//console.log("Log Event :", data);
	const taskKey = datastoreClient.key("access_log");
	datastoreClient
		.save({
			key: taskKey,
			data: data
		}).then(() => {
			console.log(`Log ${taskKey.id} created successfully.`);
		})
		.catch(err => {
			console.error('ERROR in logging:', err);
		});
}

if (module === require.main) {
	const server = app.listen(process.env.PORT || 8080, () => {
		const port = server.address().port;
		console.log("=====================================================");
		console.log(`App listening on port ${APP_NAME} at ${port}`);
		console.log("=====================================================");
	});
}

module.exports = app;