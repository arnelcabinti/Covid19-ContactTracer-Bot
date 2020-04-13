const PROFILE_TABLE = "person_profile";
const aws = require('aws-sdk');
const docClient = new aws.DynamoDB.DocumentClient();
const crypto = require("crypto");

exports.handler = async (event) => {
    console.log(event);
    let pk = await idPkGenerator(),
        insert = await saveUser({
        phoneNumber : event.currentIntent.slots.PhoneNumber,
        fullName : event.currentIntent.slots.FullName,
        caseId : event.currentIntent.slots.CaseID,
        pk : pk
    });
    
    console.log('Inserted :', insert);
    event.sessionAttributes.pk = pk;
    console.log(event.sessionAttributes);
    
    return {
        'sessionAttributes': event.sessionAttributes,
        'dialogAction': {
            'type': 'ConfirmIntent',
            intentName: "RegisterContact",
            'slots': {},
            "message": {
              "contentType": "PlainText",
              "content": "You have not added any contacts yet. Would you like to add? Type “yes” or “no”"
            },
        }
    }
};


const saveUser = async (userDetails) => {
    let params = {
      TableName: PROFILE_TABLE,
      Item: {
        'full_name' : userDetails.fullName,
        'phone_number': `+63${userDetails.phoneNumber.substring(1, userDetails.phoneNumber.length)}`,
        "pk" : userDetails.pk,
        "case_id" : userDetails.caseId,
        "timestamp" : Math.floor(new Date() / 1000)
      }
    };
    
    let result = await docClient.put(params).promise();
    return result;
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