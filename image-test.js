'use strict';

var fs = require('fs');
var RGBColor = require('RGBcolor')
var watson = require('watson-developer-cloud');
var gcloud = require('gcloud');
var path = require('path');
//prereqs for Mongo
var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');
var ObjectId = require('mongodb').ObjectID;
var mongourl = 'mongodb://localhost:27017/test';

//Adding the request library here bc microsoft doesn't have a native node API
var request = require('request');

//General stuff we need

var config = require('./config');
var GOOGKEYFILE = config.auth.google;
var MSFTCVAPIKEY = config.auth.msft;
var WATSONUSERNAME = config.auth.watson.username;
var WATSONPASSWORD = config.auth.watson.password;

var DOMCOLOR = 0.5;
var ACCCOLOR = 0.3;

function askWatson(archivefile, db) {
// TODO -- refactor this to do it one by one as the others do, instead of the zip file kludge

  var visual_recognition = watson.visual_recognition({
    url: "https://gateway.watsonplatform.net/visual-recognition-beta/api",
    password: WATSONPASSWORD,
    username: WATSONUSERNAME,
    version: 'v2-beta',
    version_date: '2015-12-02'
  });

  var params = {
    // must be a .zip file containing images
    // assumes that there is a zip archive of the command line arg using '.zip' extension
    images_file: fs.createReadStream(archivefile)
  };

  visual_recognition.classify(params, function(err, res) {
    if (err)
      console.log(err);
    else
      for(var i in res.images){
        // store results in MongoDB
        var watson = {"tags":[]};
        // start with tags
        var taglist = [];
        console.log(JSON.stringify(res.images[i]));
        for(var s in res.images[i]['scores']) {
          taglist.push({'name':res.images[i]['scores'][s]['name'], 'score':res.images[i]['scores'][s]['score']});
        }
        watson['tags'] = taglist;
        // console.log(res.images[i]['image']);
        // console.log(watson);

        db.collection('images').updateOne({"filename":res.images[i]['image']},{ $set: {"watson": watson}},{upsert:true}, function(err,results) {
          console.log("E: "+err);
          console.log("R: "+results); //{"filename":res.images[i]['image']}
        });
      }
  });
}

function askGoogle(imagefiles, db) {
  var vision = gcloud.vision({
    projectId: 'NYT-RND',
    keyFilename: GOOGKEYFILE
  });

  var types = ["landmarks", "labels", "logos", "properties", "safeSearch", "text"]
  // annotations appear to come back in this order; probably best to do this as a switch anyway

  var pointer = 0;

  (function googleping() {
  //uses an array of the image files
    vision.detect(imagefiles[pointer], types, function(err, detections, apiResponse) {
      // for each image, store detections in Mongo
      //console.log('{"image":"'+imagefiles[i]+'","googresponse":'+JSON.stringify(apiResponse)+"}");
      var goog = {"tags":[], "colors":[], "adult":{}, "text":[], "landmarks":[]}; //figure out how to add/see celebrities later. I think it's in faces.
      for (var x in apiResponse.responses) {

        if(Object.keys(apiResponse.responses[x]).length > 0) {
          var key = Object.keys(apiResponse.responses[x])[0];
          var val = apiResponse.responses[x][key];
          switch (key){
            case "labelAnnotations":
              for (var tag in val){
                var desc = val[tag]['description'];
                var blob = { 'name': desc, 'score': val[tag]['score'] };
                goog.tags.push(blob);
              }

              break;
            case "imagePropertiesAnnotation": //colors
              for (var color in val['dominantColors']['colors']){
                var obj = val['dominantColors']['colors'][color];
                var colorstring = "rgb("+obj.color.red+", "+obj.color.green+", "+obj.color.blue+")";
                var thiscolor = new RGBColor(colorstring);
                if(thiscolor.ok) {
                  var label = thiscolor.toHex();

                  var blob = { "color": label, "score": val['dominantColors']['colors'][color]['score'] };
                  goog.colors.push(blob);
                }
              }

              break;
            case "safeSearchAnnotation": 
              for (var tag in val) {
                goog.adult[tag] = val[tag] //should create entries like goog.adult.spoof: LIKELY
              }

              break;
            case "textAnnotations":
              for (var txt in val) {
                var blob = {"text":val[txt].description, 
                  "score": val[txt].score, 
                  "freebase": val[txt].mid, 
                  "locale": val[txt].locale
                };
                goog.text.push(blob);

              }
              break;
            case "landmarkAnnotations":
              for (var mark in val) {
                var blob = {"name":val[mark].description, 
                  "score": val[mark].score, 
                  "freebase": val[mark].mid, 
                  "locale": val[mark].locale,
                  "locations": []
                };
                for (var loc in val[mark].locations){
                  blob.locations.push({"latitude": val[mark].locations[loc].latLng.latitude, 
                    "longitude": val[mark].locations[loc].latLng.longitude});
                }
                goog.landmarks.push(blob);

              }
              break;
          } // end switch
        } // end if  
      } // end response for loop
      console.log("Google: inserting for pointer " + pointer);
      db.collection('images').updateOne({"filename":imagefiles[pointer]},{ $set: {"google": goog}},{upsert:true}, function(err,results) {
        if(err) {
          console.log("E: "+err);
        }
      });
      if (pointer < imagefiles.length-1) {
        pointer ++;
        googleping();
      }
    }); // end vision detect

  })();
}

function askMicrosoft(imagefiles, db) {
  var visualFeatures = "Categories,Tags,Description,Color,Adult&details=Celebrities";
  var params = {
    method: "POST",
    url: "https://api.projectoxford.ai/vision/v1.0/analyze?visualFeatures="+visualFeatures,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Ocp-Apim-Subscription-Key': MSFTCVAPIKEY
    },
    body: ""
  }

  var ptr = 0;

  (function msftping() {

    var msft = {"tags":[], "colors":[], "adult":{}, "captions":[], "people":[]};
    //make a POST request to the API and see what happens
    fs.readFile(imagefiles[ptr], function(err,data) {
      if (err) {
        console.log("Couldn't open file "+ imagefiles[ptr] + ".\nError: "+err);
      } else {
        params['body']=data;
        request(params, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            //do clevererer things here
            //console.log('{"image":"'+imagefiles[ptr]+'","msftresponse":'+body+"}");

            var data = JSON.parse(body);

            // parse tags
            for (var t in data.tags) {
              var blob = {"name": data.tags[t].name, "score": data.tags[t].confidence};
              msft.tags.push(blob);
            }

            for (var c in data.color.dominantColors){
              var thiscolor = new RGBColor(data.color.dominantColors[c]);
              if(thiscolor.ok) {
                var label = thiscolor.toHex();

                var blob = { "color": label, "score": DOMCOLOR };
                msft.colors.push(blob);
              }
            }

            var accentcolor = new RGBColor(data.color.accentColor);
            if (accentcolor.ok) {
              var blob = {"color": accentcolor.toHex(), "score": ACCCOLOR };
              msft.colors.push(blob);
            }

            // should push .isadultcontent and .adultscore (and "racy" too)
            for (var a in data.adult) {
              msft.adult[a] = data.adult[a] //should create entries like msft.isAdultContent: false
            }

            for (var x in data.description.captions) {
              var cap = data.description.captions[x].text;
              var score = data.description.captions[x].confidence;
              var blob = {"text": cap, "score": score};
              msft.captions.push(blob);
            }

            // cheating on the celebrities bit here, because no one else has them and MSFT's structure isn't terrible            

            for (var c in data.categories) {
              if((data.categories[c].hasOwnProperty("detail")) && (data.categories[c].detail.hasOwnProperty("celebrities"))){
                for (var x in data.categories[c].detail.celebrities) {
                  msft.people.push(data.categories[c].detail.celebrities[x])
                }
              }
            }

            console.log("MSFT: inserting for pointer " + ptr);
            db.collection('images').updateOne({"filename":imagefiles[ptr]},{ $set: {"msft": msft}},{upsert:true}, function(err,results) {
              if(err) {
                console.log("E: "+err);
              }
            }); //end db callback
          } 
          if (ptr < imagefiles.length-1) {
            ptr ++;
            msftping();
          } 
        }); //end API callback
      } //end fsopen else
    });
  })(); //call msftping once then let it call itself
}

// BEGIN MAIN

if(process.argv[2] && (process.argv[2].length > 0)) {
  var dir = process.argv[2];
  //var color = new RGBColor('blue');
  //console.log("Blue is "+color.toHex());
  //console.log("Processing images from " + dir);
  //Validate that there's a zip file
  fs.open(dir+".zip", "r", function(error, fd) {

    if (error) {
        // either file does not exist or simply is not readable
        throw new Error("Failed to open expected zip archive at "+dir+".zip");
    }
    fs.readdir(dir, function (err, files) {
      if (err) {
          throw err;
      }
      MongoClient.connect(mongourl, function(err, db) {
        assert.equal(null, err);
        console.log("Connected correctly to server.");

        var fileslist = [];
        var objectlist = [];
        files.map(function (file) {
            return path.join(dir, file);
        }).filter(function (file) {
            return fs.statSync(file).isFile();
        }).forEach(function (file) {
            fileslist.push(file);
            objectlist.push({"filename":file});
        });
        db.collection('images').insertMany(objectlist, function(err, res){
          //console.log(fileslist);
          askWatson(dir+".zip", db);//, askGoogle(fileslist, askMicrosoft(fileslist)));
          askMicrosoft(fileslist, db);
          askGoogle(fileslist, db);
        });

        //db.close();
      });
    });
  });
}
else
{
  console.log(process.argv[1] + " requires a valid directory of images as a command-line argument.")
}