// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');

var ecs = new AWS.ECS();
const compression = require('compression');
const fs = require('fs');
const http = require('http');
const url = require('url');
const {
  v4: uuidv4
} = require('uuid');
var docClient = new AWS.DynamoDB.DocumentClient({
  region: 'us-east-1'
});
const meetingsTable = 'meetingsTable';

// Store created meetings in a map so attendees can join by meeting title.
const meetingTable = {};

// Load the contents of the web application to be used as the index page.
const app = process.env.npm_config_app || 'meetingV2';
const indexPagePath = `dist/${app}.html`;

console.info('Using index path', indexPagePath);

const indexPage = fs.readFileSync(indexPagePath);

// Create ans AWS SDK Chime object. Region 'us-east-1' is currently required.
// Use the MediaRegion property below in CreateMeeting to select the region
// the meeting is hosted in.
const chime = new AWS.Chime({
  region: 'us-east-1'
});
const sts = new AWS.STS({
  region: 'us-east-1'
})

// Set the AWS SDK Chime endpoint. The global endpoint is https://service.chime.aws.amazon.com.
const endpoint = process.env.ENDPOINT || 'https://service.chime.aws.amazon.com';
console.info('Using endpoint', endpoint);

chime.endpoint = new AWS.Endpoint(endpoint);

const captureS3Destination = 'arn:aws:s3:::yuinitmediacapture';
if (captureS3Destination) {
  console.info(`S3 destination for capture is ${captureS3Destination}`)
} else {
  console.info(`S3 destination for capture not set.  Cloud media capture will not be available.`)
}

async function putInfo(joinInfo) {
  console.log("In putInfo")
  var params = {
    TableName: 'meetingsTable',
    Key: {
      "title": joinInfo.Title,
    },
    UpdateExpression: "SET  #mId = :mId, #ai = list_append(if_not_exists(#ai, :empty), :ai)",
    ExpressionAttributeNames: {
      '#mId': 'meetingId',
      '#ai': 'AttendeeInfo'
    },
    ExpressionAttributeValues: {
      ":mId": joinInfo.Meeting.MeetingId,
      ":ai": [joinInfo.Attendee.AttendeeId],
      ":empty": []
    }
  }
  console.log(params)
  try {
    await docClient.update(params).promise()
  } catch (err) {
    console.log(err)
    return err
  }
}

async function getEvent(title) {
  console.log(title)
  var params = {
    TableName: meetingsTable,
    Key: {
      "title": title
    }
  };
  try {
    const response = await docClient.get(params).promise()
    console.log("REPONSE FROM DDB IS ", response)
    return response
  } catch (err) {
    return err
  }
}

async function meetingExist(meetingId){
  var params = {
    MeetingId: meetingId /* required */
  };
  try {
    return await chime.getMeeting(params).promise();
  }
  catch (e) {
    return null;
  }
}


function serve(host = '127.0.0.1:8080') {
  // Start an HTTP server to serve the index page and handle meeting actions
  http.createServer({}, async (request, response) => {
    log(`${request.method} ${request.url} BEGIN`);
    try {
      // Enable HTTP compression
      compression({})(request, response, () => {});
      const requestUrl = url.parse(request.url, true);
      if (request.method === 'GET' && requestUrl.pathname === '/') {
        // Return the contents of the index page
        respond(response, 200, 'text/html', indexPage);

      }else if(request.method === 'GET' && requestUrl.pathname) {
      
        // Return the contents of the index page
        respond(response, 200, 'text/html', indexPage);
      
      } else if (process.env.DEBUG && request.method === 'POST' && requestUrl.pathname === '/join') {
        // For internal debugging - ignore this.
        respond(response, 201, 'application/json', JSON.stringify(require('./debug.js').debug(requestUrl.query), null, 2));
      } else if (request.method === 'POST' && requestUrl.pathname === '/join') {
        if (!requestUrl.query.meetingId ) {
          throw new Error('Need parameters: meetingId, name, region');
        }
        var  meeting;
        var record = requestUrl.query.record
        var currentTime = new Date().getTime()
        var startTime = requestUrl.query.scheduledStart
        var endTime = requestUrl.query.scheduledEnd
        if(record){
          console.log("recorder joined")
          var queryString = "m=" + requestUrl.query.meetingId + "&internalMeetingId=" + requestUrl.query.internalMeetingId
        }else{
          console.log("person joined")
        var queryString = "m=" + requestUrl.query.meetingId + "&title=" + requestUrl.query.title + "&scheduledStart=" + requestUrl.query.scheduledStart + "&scheduledEnd=" + requestUrl.query.scheduledEnd + "&attendeeId=" + requestUrl.query.attendeeId + "&name=" + requestUrl.query.name + "&type=" + requestUrl.query.type + "&internalMeetingId=" + requestUrl.query.internalMeetingId
       //c
        }
       
        var sha1 = require('sha1');
        var accessToken = sha1(queryString + '3HDEY393923BNNDNDdebri292445sdedf')
        console.log(accessToken, requestUrl.query.accessToken, queryString)
        if (accessToken != requestUrl.query.accessToken) {
          throw new Error('Need parameters: accessToken');
        }

        // Look up the meeting by its title. If it does not exist, create the meeting.
         if (requestUrl.query.internalMeetingId) {
           console.log("requestUrl.query.internalMeetingId",requestUrl.query.internalMeetingId)
         var  isExist =  await meetingExist(requestUrl.query.internalMeetingId)
        
          console.log("isExist",isExist)
          if(!isExist){

            if(currentTime>endTime){
              throw new Error('Meeting Time exceded');
            }
            var bufferTime = 10*60000
            var start_buffer = startTime-bufferTime

            if(currentTime<start_buffer){
              throw new Error('Please Join before 10 minutes');
            }
           

        //authentication 
       meeting = await chime.createMeeting({
          // Use a UUID for the client request token to ensure that any request retries
          // do not create multiple meetings.
          ClientRequestToken: uuidv4(),
          // Specify the media region (where the meeting is hosted).
          // In this case, we use the region selected by the user.
          MediaRegion: 'us-east-1',
          // Any meeting ID you wish to associate with the meeting.
          // For simplicity here, we use the meeting title.
          ExternalMeetingId: requestUrl.query.meetingId.substring(0, 64),
        }).promise();
      }else{
        meeting = isExist
      }

        }else{
          meeting = await chime.createMeeting({
            ClientRequestToken: uuidv4(),
            MediaRegion: requestUrl.query.region,
            ExternalMeetingId: requestUrl.query.meetingId.substring(0, 64),
          }).promise();
        }

        meeting.title = requestUrl.query.title
        console.log("meeting", meeting)
        // Create new attendee for the meeting
        const attendee = await chime.createAttendee({
          // The meeting ID of the created meeting to add the attendee to
          MeetingId: meeting.Meeting.MeetingId,
          ExternalUserId: `${uuidv4().substring(0, 8)}#${requestUrl.query.name}`.substring(0, 64),
        }).promise();
        respond(response, 201, 'application/json', JSON.stringify({
          JoinInfo: {
            Meeting: meeting,
            Attendee: attendee,
          },
        }, null, 2));
      } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
        // End the meeting. All attendee connections will hang up.
        await chime.deleteMeeting({
          MeetingId: requestUrl.query.internalMeetingId,
        }).promise();
        respond(response, 200, 'application/json', JSON.stringify({}));
      } else if (request.method === 'POST' && requestUrl.pathname === '/startCapture') {
        if (captureS3Destination) {
          console.log("meetingTable", meetingTable)
          const callerInfo = await sts.getCallerIdentity().promise()
          pipelineInfo = await chime.createMediaCapturePipeline({
            SourceType: "ChimeSdkMeeting",
            SourceArn: `arn:aws:chime::${callerInfo.Account}:meeting:${meetingTable[requestUrl.query.meetingId].Meeting.MeetingId}`,
            SinkType: "S3Bucket",
            //SinkArn: captureS3Destination,
            SinkArn: "arn:aws:s3:::" + "yuinitmediacapture" + "/captures/" + meetingTable[requestUrl.query.meetingId].Meeting.MeetingId,
            ChimeSdkMeetingConfiguration: {
              "ArtifactsConfiguration": {
                "Audio": {
                  "MuxType": "AudioOnly"
                },
                "Video": {
                  "State": "Enabled",
                  "MuxType": "VideoOnly"
                },
                "Content": {
                  "State": "Enabled",
                  "MuxType": "ContentOnly"
                }
              }
            }
          }).promise();
          meetingTable[requestUrl.query.meetingId].Capture = pipelineInfo.MediaCapturePipeline;
          respond(response, 201, 'application/json', JSON.stringify(pipelineInfo));
        } else {
          console.warn("Cloud media capture not available")
          respond(response, 500, 'application/json', JSON.stringify({}))
        }
      } else if (request.method === 'POST' && requestUrl.pathname === '/endCapture') {
        if (captureS3Destination) {
          pipelineInfo = meetingTable[requestUrl.query.meetingId].Capture;
          await chime.deleteMediaCapturePipeline({
            MediaPipelineId: pipelineInfo.MediaPipelineId
          }).promise();
          meetingTable[requestUrl.query.meetingId].Capture = undefined;
          respond(response, 200, 'application/json', JSON.stringify({}));
        } else {
          console.warn("Cloud media capture not available")
          respond(response, 500, 'application/json', JSON.stringify({}))
        }
      } else if (request.method === 'GET' && requestUrl.pathname === '/fetch_credentials') {
        const awsCredentials = {
          accessKeyId: AWS.config.credentials.accessKeyId,
          secretAccessKey: AWS.config.credentials.secretAccessKey,
          sessionToken: AWS.config.credentials.sessionToken,
        };
        respond(response, 200, 'application/json', JSON.stringify(awsCredentials), true);
      } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
        // End the meeting. All attendee connections will hang up.
        await chime.deleteMeeting({
          MeetingId: meetingTable[requestUrl.query.meetingId].Meeting.MeetingId,
        }).promise();
        respond(response, 200, 'application/json', JSON.stringify({}));
      } else if (request.method === 'POST' && requestUrl.pathname === '/start_transcription') {
        const languageCode = requestUrl.query.language;
        const region = requestUrl.query.region;
        let transcriptionConfiguration = {};
        if (requestUrl.query.engine === 'transcribe') {
          transcriptionConfiguration = {
            EngineTranscribeSettings: {
              LanguageCode: languageCode,
            }
          };
          if (region) {
            transcriptionConfiguration.EngineTranscribeSettings.Region = region;
          }
        } else if (requestUrl.query.engine === 'transcribe_medical') {
          transcriptionConfiguration = {
            EngineTranscribeMedicalSettings: {
              LanguageCode: languageCode,
              Specialty: 'PRIMARYCARE',
              Type: 'CONVERSATION',
            }
          };
          if (region) {
            transcriptionConfiguration.EngineTranscribeMedicalSettings.Region = region;
          }
        } else {
          return response(400, 'application/json', JSON.stringify({
            error: 'Unknown transcription engine'
          }));
        }

        await chime.startMeetingTranscription({
          MeetingId: meetingTable[requestUrl.query.meetingId].Meeting.MeetingId,
          TranscriptionConfiguration: transcriptionConfiguration
        }).promise();
        respond(response, 200, 'application/json', JSON.stringify({}));
      } else if (request.method === 'POST' && requestUrl.pathname === '/stop_transcription') {
        await chime.stopMeetingTranscription({
          MeetingId: meetingTable[requestUrl.query.meetingId].Meeting.MeetingId
        }).promise();
        respond(response, 200, 'application/json', JSON.stringify({}));
      } else if (request.method === 'GET' && requestUrl.pathname === '/fetch_credentials') {
        const awsCredentials = {
          accessKeyId: AWS.config.credentials.accessKeyId,
          secretAccessKey: AWS.config.credentials.secretAccessKey,
          sessionToken: AWS.config.credentials.sessionToken,
        };
        respond(response, 200, 'application/json', JSON.stringify(awsCredentials), true);
      } else if (request.method === 'GET' && requestUrl.pathname === '/audio_file') {
        const filePath = 'dist/speech.mp3';
        fs.readFile(filePath, {
          encoding: 'base64'
        }, function (err, data) {
          if (err) {
            log(`Error reading audio file ${filePath}: ${err}`)
            respond(response, 404, 'application/json', JSON.stringify({}));
            return;
          }
          respond(response, 200, 'audio/mpeg', data);
        });
      } else {
        respond(response, 404, 'text/html', '404 Not Found');
      }
    } catch (err) {
      respond(response, 400, 'application/json', JSON.stringify({
        error: err.message
      }, null, 2));
    }
    log(`${request.method} ${request.url} END`);
  }).listen(host.split(':')[1], host.split(':')[0], () => {
    log(`server running at http://${host}/`);
  });
}

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function respond(response, statusCode, contentType, body, skipLogging = false) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.end(body);
  if (contentType === 'application/json' && !skipLogging) {
    log(body);
  }
}

module.exports = {
  serve
};
