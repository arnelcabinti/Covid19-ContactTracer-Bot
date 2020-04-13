exports.handler = async (event) => {
    console.log(event);
    let curSessionAttr = event.sessionAttributes;
   
    if(curSessionAttr === null || Object.keys(curSessionAttr).length === 0 ){
        return {
            sessionAttributes: {},
            dialogAction: { 
                type: "Close",
                fulfillmentState: "Fulfilled",
                message: {
                    contentType: "PlainText", 
                    content: "You aren't identified. Please TYPE “Hello” to login/register."
                }
            }
        };
    }
    
    if(event.currentIntent.confirmationStatus == "Denied"){
        return {
            sessionAttributes: {},
            dialogAction: { 
                type: "Close",
                fulfillmentState: "Fulfilled",
                message: {
                    contentType: "PlainText", 
                    content: "Alright, Have a nice day. Thank you!"
                }
            }
        }
    }
    
    return {
        'sessionAttributes': curSessionAttr,
        'dialogAction': {
            'type': 'Delegate',
            'slots': event.currentIntent.slots
        }
    }
};
