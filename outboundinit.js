const OUT_INTENT = "Outbound",
      PROFILE_TABLE = "person_profile",
      CONTACT_LIST_TABLE = "contact_person",
      SOURCE_AWSLEX = 1,
      SOURCE_FACEBOOK = 2,
      SOURCE_SMS = 3;
      
const aws = require('aws-sdk');

// open connection
const docClient = new aws.DynamoDB.DocumentClient();

let requestOrigin = (requestAttributes,userId) => {
    if(requestAttributes == null && userId.length != 10) {
        return SOURCE_AWSLEX;
    }
    else if (userId.length == 10){
        return SOURCE_SMS;
    }
    else if (requestAttributes != null && requestAttributes["x-amz-lex:channel-type"] == "Facebook") {
        return SOURCE_FACEBOOK;
    }
}

exports.handler = async (event) => {
    // TODO implement
    
    console.log(event);
    
    if (event.currentIntent.slots.Answer == null) {
    event = {
  messageVersion: '1.0',
  invocationSource: 'DialogCodeHook',
  userId: '9952129694',
  sessionAttributes: null,
  requestAttributes: null,
  bot: { name: 'Bot_CovidPH', alias: 'BETA', version: '4' },
  outputDialogMode: 'Text',
  currentIntent: {
    name: 'User',
    slots: { Answer : null },
    slotDetails: { Answer: [Object] },
    confirmationStatus: 'None'
  },
  inputTranscript: 'yes',
  recentIntentSummaryView: null,
  sentimentResponse: null
}
}       
   let requestOriginVal = requestOrigin(event.requestAttributes,event.userId),
       response = event.inputTranscript.toLowerCase(),
       sessionAttributes = {
            pk : "",
            timestamp : 0 
       }
   
   if(requestOriginVal == SOURCE_SMS && (response == "yes" || response == "no")){
        let contactData = await getUserData(`0${event.userId}`,{},event.currentIntent.slots);
        sessionAttributes.pk = contactData.person_pk;
        sessionAttributes.timestamp = contactData.timestamp;
        if(contactData.Count == 0){
            return close("No contacts record found.");
        }

        event.currentIntent.slots.Answer = response;
        console.log("sesstion attr:", sessionAttributes);

        if(response == "yes"){
            let  updateRecord= await updatePerson("y",sessionAttributes);
            console.log(updateRecord);
            return close("You have indicated that you have one or more symptoms related to COVID-19. Kindly proceed to the nearest healthcare facility to be tested");
        }
        else if(response == "no"){
             let updateRecord = await updatePerson("n",sessionAttributes);
             console.log(updateRecord);
             return close("You have indicated that you currently do not have any symptoms related to COVID-19. We will reach out to you for a daily check-in over the next 14 days");
        }
        
        return elicitSlot(event.sessionAttributes,
            OUT_INTENT,
            {},
            "Answer",
            "Your input is not recognize. Please reply “Yes” or “No") ;
    }

    console.log(requestOriginVal);
    return close("This is for SMS only.");
};

let getUserData = async (phoneNumber,sessionAttribute,slots) => {
    let newPN = `+63${phoneNumber.substring(1, phoneNumber.length)}`;
    console.log(`Phone number: [${phoneNumber}]`);
    console.log(`Strip number: [${newPN}]`);

    let params = {
        TableName: CONTACT_LIST_TABLE,
        ProjectionExpression:"#pk, #fn, #pn, #ti",
        FilterExpression: "#pn = :pnU",
        ExpressionAttributeNames:{
            "#pn" : "phone_number",
            "#fn" : "full_name",
            "#pk" : "person_pk",
            "#ti" : "timestamp"
        },
        ExpressionAttributeValues: {
            ":pnU": newPN
        },
    };
    
    const data = await docClient.scan(params).promise();
    if(data.Items.length == 0){
        return close("You aren't identified. Please TYPE “Hello” to login/register.");
    }
    let userData = data.Items[0];
    return userData
}

const updatePerson = async (answer,sess) => {
    // Update the item, unconditionally,
    var params = {
        TableName: CONTACT_LIST_TABLE,
        Key:{
            "person_pk": sess["pk"],
            "timestamp" : parseInt(sess["timestamp"])
        },
        UpdateExpression: "set symptoms = :s",
        ExpressionAttributeValues:{
            ":s": answer,
        },
        ReturnValues:"UPDATED_NEW"
    };
    console.log("params ", params);
    let result = await docClient.update(params).promise();
    console.log("my results ", result);
    return result
}

// Responses
const close = (message) => {
    return {
        sessionAttributes: {},
        dialogAction: { 
            type: "Close",
            fulfillmentState: "Fulfilled",
            message: {
                contentType: "PlainText", 
                content: message
            }
        }
    };
}

const elicitSlot = (sessionAttributes,intent,slots,slotToElicit,message) => {
    return {
        sessionAttributes: sessionAttributes,
        dialogAction: {
            type: "ElicitSlot",
            intentName: intent,
            slots: slots,
            slotToElicit: slotToElicit,
            message: {
                contentType: "PlainText", 
                content: message
            }
        }
    }
}