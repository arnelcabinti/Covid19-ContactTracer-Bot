'use strict'

const aws = require('aws-sdk'),
      digitGenerator = require('./node_modules/crypto-secure-random-digit'),
      crypto = require("crypto");

// global constants
const USER_INTENT = "User",
      PROFILE_TABLE = "person_profile",
      CONTACT_LIST_TABLE = "contact_person",
      OTP_TABLE = "onetimepin",
      SOURCE_AWSLEX = 1,
      SOURCE_FACEBOOK = 2,
      SOURCE_SMS = 3,
      OTP_RETRY_COUNT = 3;
      
// open connection
const docClient = new aws.DynamoDB.DocumentClient();

let otpTry = 0;

exports.handler = async (event) => {
    console.log(event);
    let input = event.inputTranscript.toLowerCase(),
        startText = ["hello","hi", "hallo", "hullo"]

    // reset
    if(startText.indexOf(input) > -1){
        event.sessionAttributes = {};
        otpTry = 0;
    }

    console.log(`Lex data: [${JSON.stringify(event)}]`);
    if (!verifyIntent(event)){
        return close("You're accessing ivalid intent.");
    }

    let response = await verifyUser(event);
    return response;
};

let verifyIntent = (event) => {
    let intentName = event.currentIntent.name;
    console.log(`Intent name: [${intentName}]`);

    if (intentName !== USER_INTENT){
        console.log('Ivalid intent name');
        return false;
    }
    return true
}

let verifyUser = async (event) => {
    let curSessionAttr = event.sessionAttributes,
        sourceRequest = requestOrigin(event.requestAttributes,event.userId),
        sessionAttribute = {
            email : "user@domain.com", 
            auth : false, 
            uuid : null, 
            currentOrder: "", 
            encryptedPin: null, 
            address: "",
            newContactCount: "",
            pk: "",
            requestOrigin: sourceRequest,
            otpUid : "",
            otpValid : false,
            isPhoneValid : false
            
        },
        slots = {
            FullName: event.currentIntent.slots.FullName,
            CaseID:  event.currentIntent.slots.CaseID,
            PhoneNumber:  event.currentIntent.slots.PhoneNumber,
            otp :  event.currentIntent.slots.otp
        },
        message = "Welcome to the toll-free Philippine Department of Health COVID-19 contact tracing service. What\'s your 11 digit mobile number?",
        firstItemNull = 'otp';
    
    if(sourceRequest == SOURCE_SMS){
        curSessionAttr = sessionAttribute;
        slots.PhoneNumber = `0${event.userId}`;
        firstItemNull = "FullName";
    }
    console.log("Current Session: ", curSessionAttr);
    if(curSessionAttr !== null && Object.keys(curSessionAttr).length !== 0){
        sessionAttribute = curSessionAttr;
        console.log("is sms: ", sourceRequest == SOURCE_SMS);
        console.log("slots ", slots);
        let phoneNumber = sourceRequest == SOURCE_SMS ? slots.PhoneNumber : event.inputTranscript;
        console.log(`phone number: ${phoneNumber}`);
        
        if(!isPhoneNumber(phoneNumber) && event.currentIntent.slots[firstItemNull] == null ){
            console.log("Not valid phone number.");
            message = "The phone number that you provided is not valid.\nPlease re-type using the following format: 09xxxxxxxxx";
        }
        else if(event.currentIntent.slots.otp != null && (event.currentIntent.slots.FullName == null || sessionAttribute.pk.length != "") && sourceRequest != SOURCE_SMS){
            console.log("OTP  ", event.inputTranscript);
            console.log("UID  ", sessionAttribute.otpUid);
            let isOTPValid = await checkOTP(sessionAttribute.otpUid,event.inputTranscript);
            console.log("save results  ", isOTPValid);

            if(!isOTPValid){
                otpTry+=1;
                console.log(otpTry);
                if(otpTry >= OTP_RETRY_COUNT){
                    return close(`You meet the ${OTP_RETRY_COUNT} retry limit.Please TYPE “Hello” to restart this service and enter your mobile number again.`);
                }
                return elicitSlot(
                    sessionAttribute,
                    USER_INTENT,
                    slots,
                    "otp",
                    "The provided OTP is not valid. Please re-type it again."
                );
            }

            sessionAttribute.otpValid = true;
            if(sessionAttribute.pk.length == ""){
                return delegate(sessionAttribute,slots);
            }
            else {
                let response = await getUserData(slots.PhoneNumber,sessionAttribute, slots, sourceRequest);
                return response;
            }
        }
        else {
            let response = await getUserData(phoneNumber,sessionAttribute, slots, sourceRequest);
            return response;
        }
    }

    console.log("Message: ", message);

    return elicitSlot(
        sessionAttribute,
        USER_INTENT,
        slots,
        "PhoneNumber",
        message
    );
}

let getUserData = async (phoneNumber,sessionAttribute,slots, requestOrigin) => {
    let newPN = `+63${phoneNumber.substring(1, phoneNumber.length)}`;
    console.log(`Phone number: [${phoneNumber}]`);
    console.log(`Strip number: [${newPN}]`);
    
    let params = {
        TableName: PROFILE_TABLE,
        ProjectionExpression:"#pk, #fn, #ci, #pn",
        FilterExpression: "#pn = :pnU",
        ExpressionAttributeNames:{
            "#pn" : "phone_number",
            "#fn" : "full_name",
            "#ci" : "case_id",
            "#pk" : "pk"
        },
        ExpressionAttributeValues: {
            ":pnU": newPN
        },
    };
    
    const data = await docClient.scan(params).promise();

    if(data.Items.length == 0){
        console.log("Validate OTP: ", sessionAttribute.otpValid);
        if(sessionAttribute.otpValid == "true" || requestOrigin == SOURCE_SMS){
            if(slots.FullName == null){
                return elicitSlot(
                    sessionAttribute,
                    USER_INTENT,
                    slots,
                    "FullName",
                    "Welcome to the toll-free Philippine Department of Health COVID-19 contact tracing service. What\'s your full name?",
                );
            }
            slots.otp = "no_value";
            return delegate(sessionAttribute,slots);
        }

        return await sendOTP(sessionAttribute,slots,newPN);
    }

    let userData = data.Items[0],
        contactList = await getContactList(userData.pk),
        message = "You have not added any contacts yet. Would you like to add another contact? Type “yes” or “no”";
       
        
    if(contactList.Count > 0) {
        message = `Hi ${userData.full_name}.\n`;
        message += `You have ${contactList.Count} contact(s):`;

        // combine contact list
        for (let value of contactList.Items) {
            message += `\n\n${value.full_name} ${value.phone_number}`;
        }

        message += "\n\nWould you like to add another contact? Type “yes” or “no”";
    }

    slots.FullName = userData.full_name;
    slots.CaseID = userData.case_id;
    slots.PhoneNumber = phoneNumber;
    sessionAttribute.auth = true;
    sessionAttribute.pk = userData.pk;

    if(sessionAttribute.otpValid == "false"){
        return await sendOTP(sessionAttribute,slots,newPN);
    }
    
    return confirmIntent(
        sessionAttribute,
        "RegisterContact",
        {},
        message
    );
}

let getContactList = async (personPK) => {
    let params = {
        TableName : CONTACT_LIST_TABLE,
        ProjectionExpression:"#ppk, #pn, #fn",
        KeyConditionExpression: "#ppk = :ppk",
        ExpressionAttributeNames:{
            "#pn" : "phone_number",
            "#fn" : "full_name",
            "#ppk" : "person_pk"
        },
        ExpressionAttributeValues: {
            ":ppk": personPK,
        }
    };
    const data = await docClient.query(params).promise();
    return data
}

const requestOrigin = (requestAttributes,userId) => {
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

const saveOTP = async (uid,otp) => {
    let params = {
      TableName: OTP_TABLE,
      Item: {
        'uuid' : uid,
        "otp_pin" : otp,
        "timestamp" : curTimestamp()
      }
    };
    
    let result = await docClient.put(params).promise();
    return result;
}

const isPhoneNumber = (phoneNumber) => {
    if(phoneNumber != null && phoneNumber.length != 11 || phoneNumber.substring(0,2) != "09"){
        console.log(phoneNumber.substring(0,2));
        return false;
    }
    return true;
}

const generateOTPCode = () => {
    const randomDigits = digitGenerator.randomDigits(6);
    return randomDigits.join("");
}

const idPkGenerator = () => {
    let currentstr = `K26CnPNxKw${(new Date()).valueOf().toString()}qy7jUTcuey`,
        random = Math.random().toString(),
        hash = crypto.createHash("sha256").update(currentstr + random).digest('hex');
    
    let lvl1 = hash.substring(0,8),
        lvl2 = hash.substring(8,12),
        lvl3 = hash.substring(12,16),
        lvl4 = hash.substring(16,20),
        lvl5 = hash.substring(20,32);
        
    return `${lvl1}-${lvl2}-${lvl3}-${lvl4}-${lvl5}`;
}

const sendSMS = async (message,phoneNumber) => {
    var params = {
        Message: message,
        PhoneNumber: phoneNumber,
        MessageAttributes: {
            'AWS.SNS.SMS.SenderID': {
                'DataType': 'String',
                'StringValue': "CovidPHOTP"
            }
        }
    };

    let sns = new aws.SNS({ apiVersion: '2010-03-31' });
    let publish = await sns.publish(params).promise();
    console.log(publish);
    return publish;
}

const checkOTP = async (otpId,otpUser) => {
    let params = {
        TableName : OTP_TABLE,
        ProjectionExpression:"#id, #otp, #t",
        KeyConditionExpression: "#id = :id",
        ExpressionAttributeNames:{
            "#t" : "timestamp",
            "#otp" : "otp_pin",
            "#id" : "uuid"
        },
        ExpressionAttributeValues: {
            ":id": otpId,
        }
    };
    
    const data = await docClient.query(params).promise();

    if(data.Count == 0 || data == null){
        return false
    }
    
    if(data.Items[0].otp_pin !== otpUser){
        return false
    }
    
    // check expiration 5 mins (300 sec)
    if((curTimestamp() - data.Items[0].timestamp) > 300){
        return false
    }

    console.log(data.Items[0].timestamp);
    console.log(curTimestamp() - data.Items[0].timestamp);
    console.log("OTP details: ", data)
    return true
}

const curTimestamp = () => {
    return Math.floor(new Date() / 1000);
}


const sendOTP = async (sessionAttribute,slots,newPN) => {
    let otp = generateOTPCode(),
        uid = idPkGenerator(),
        saveOTPDetails = await saveOTP(uid,otp),
        message = `Your One-Time Password (OTP) for your Covid-19 tracker registration is ${otp}. OTP will expire in 5 mins.`,
        smstes = await sendSMS(message, newPN);

    console.log("otp details: ", saveOTPDetails);
    console.log("sms: ", smstes);
    sessionAttribute.otpUid = uid;
    otpTry = 0;
    return elicitSlot(
        sessionAttribute,
        USER_INTENT,
        slots,
        "otp",
        "Your One-Time Password (OTP) has been sent to your number. Please type it for verification."
    );
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

const confirmIntent = (sessionAttributes,intent,slots,message) => {
    return {
        sessionAttributes : sessionAttributes,
        dialogAction: {
            type: "ConfirmIntent",
            intentName: intent,
            slots: slots,
            message: {
              contentType: "PlainText",
              content: message
            },
        }
    }
}

const delegate = (sessionAttributes,slots) => {
    return {
        sessionAttributes: sessionAttributes,
        dialogAction: {
            type: "Delegate",
            slots: slots
        }
    }
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