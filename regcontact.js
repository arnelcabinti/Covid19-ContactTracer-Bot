
const CONTACT_REGISTER_INTENT = "RegisterContact";
const CONTACT_TABLE = "contact_person";
const aws = require('aws-sdk');
const docClient = new aws.DynamoDB.DocumentClient();

let countInserted = 0;

exports.handler = async (event) => {
    console.log(event);
    let firstRecordData = event.currentIntent.slots.firstContact;

    console.log("Save Contact");
    let message = "Recorded. Please keep entering the contacts one at a time. Type “Stop” after you have entered your last contact.",
        firstRecord = false,
        recordData = event.currentIntent.slots.FullName,
        slots = {
            firstContact: "SAMPLE",
            FullName : null
        },
        defaulfslotToElicit = "FullName";
        
    if(firstRecordData != 'SAMPLE'){
        firstRecord = true;
    }
    
    if(!firstRecord && recordData.toLowerCase() == "stop"){
        let finalCount = countInserted;
        countInserted = 0;
        return {
            sessionAttributes: {},
            dialogAction: {
                type: "Close",
                fulfillmentState: "Fulfilled",
                message: {
                    contentType: "PlainText", 
                    content: `You have submitted ${finalCount} contact(s). Thank you for playing your part in the fight against COVID-19.” “Type “Hello” again to restart this service and submit more contacts as you recall them over time.`
                }
            }
        }
    }
    else {
        let saveDetails = (firstRecordData == 'SAMPLE') ? recordData : firstRecordData;
        saveDetails = saveDetails.trim().split(" ");
        
        if(saveDetails.length < 3 || !isPhoneNumber(saveDetails[saveDetails.length - 1])){
            message = "The contact details that you provided are not valid.\nPlease re-type using the following format: \nFullName<SPACE>MobileNumber (09xxxxxxxxx)"
            
            if(firstRecord){
                defaulfslotToElicit = "firstContact";
                slots.firstContact = event.inputTranscript;
            }
        }
        else {
            countInserted +=1;
            let result = await saveContact(saveDetails,event.sessionAttributes.pk);
            console.log(result);
        }
    }
    
    return {
        sessionAttributes : event.sessionAttributes,
        dialogAction: {
        type: "ElicitSlot",
            intentName: CONTACT_REGISTER_INTENT,
            slots: slots,
            slotToElicit: defaulfslotToElicit,
            message: {
                contentType: "PlainText", 
                content: message
            }
        }
    }
};

const saveContact = async (contactDetails,pk) => {
    let params = {
      TableName: CONTACT_TABLE,
      Item: {
        'full_name' : `${contactDetails[0]} ${contactDetails.length > 3 ? contactDetails[1] + " " + contactDetails[2] : contactDetails[1]}`,
        'phone_number': `+63${contactDetails[contactDetails.length - 1].substring(1, contactDetails[contactDetails.length - 1].length)}`,
        "person_pk" : pk,
        "timestamp" : Math.floor(new Date() / 1000)
      }
    };
    
    let result = await docClient.put(params).promise();
    return result;
}

const isPhoneNumber = (phoneNumber) => {
    console.log(phoneNumber.substring(0,2));
    if(phoneNumber.length != 11 || phoneNumber.substring(0,2) != "09"){
        return false;
    }
    return true;
}