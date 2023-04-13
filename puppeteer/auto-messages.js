const puppeteer = require("puppeteer");
const WebSocketClient = require('websocket').client;
const fs = require('fs');

let cachedConversationIds = new Map();

(async () => {
    //create a event listener for when the program exits
    saveOnExit = function () {
        console.log("saving");
        process.stdin.resume();
        //save cachedConversationIds to a file as json 
        let jsonCachedConversationIds = JSON.stringify(Array.from(cachedConversationIds));
        try {
            fs.writeFileSync('cachedConversationIds.json', jsonCachedConversationIds);
            console.log("The file was saved!");

        } catch (err) {
            console.error(err);
        }
        process.exit();
    };
    process.on('exit', saveOnExit);

    //catches ctrl+c event
    process.on('SIGINT', saveOnExit);

    // catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', saveOnExit);
    process.on('SIGUSR2', saveOnExit);

    //catches uncaught exceptions
    process.on('uncaughtException', (err) => {
        console.log("yo, the code crashed");
        console.error(err);
        saveOnExit();
    });
    //load cachedConversationIds from a file as json
    let jsonCachedConversationIds = fs.readFileSync("cachedConversationIds.json");
    cachedConversationIds = new Map(JSON.parse(jsonCachedConversationIds));
    console.log("loaded cachedConversationIds: ", cachedConversationIds);

    const browser = await puppeteer.launch({ headless: false, userDataDir: "./user_data" });
    const page = await browser.newPage();
    await page.goto("https://messages.google.com/web/conversations/new");
    await page.setViewport({ width: 2080, height: 2024 });

    let ws = new WebSocketClient();
    ws.on('connect', function (connection) {
        connection.on('error', function (error) {
            console.log('Connection Error: ' + error.toString());
        });
        connection.on('close', function () {
            console.log('Connection Closed');
        });
        connection.on('message', async function (event) {
            console.log("GOT MESSAGE:", event.utf8Data);
            let message = JSON.parse(event.utf8Data).message;
            console.log(message);
            await sendMessage(message.person, message.text, page);
            connection.send("Success");
        });
        console.log("started websocket");
    });
    ws.on('connectFailed', function (error) {
        console.log('Connect Error: ' + error.toString());
    });
    ws.connect("http://127.0.0.1:8000/backend");
})();

//"https://instantmessaging-pa.googleapis.com/$rpc/google.internal.communications.instantmessaging.v1.Messaging/SendMessage"
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/ReceiveMessages
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/PullMessages
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/AckMessages
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/PrewarmReceiver
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/Echo
// {X-Goog-Api-Key: "AIzaSyCA4RsOZUFrm9whhtGosPlJLmVPnfSHKz8"}

async function getMessages(person, start, end, page) {
    if (!cachedConversationIds.has(person)) {
        await page.emulateIdleState({ isUserActive: true, isScreenUnlocked: true });
        await page.waitForSelector("input");
        await typeInInput(person, page);
        await page.type("input", " ");
        while (true) {
            let input = await (await page.$('input'));
            if (input != undefined) {
                input.press('Enter');
            } else {
                break;
            }
        }
    } else {
        gotoFast("/web/conversations/" + cachedConversationIds.get(person), page);
    }
    await page.waitForSelector(".input");
    let message_objects = await page.evaluate(async () => {
        let messages = document.getElementsByTagName("mws-message-wrapper");
        await new Promise((resolve) => {
            let interval = setInterval(() => {
                if (messages.length > 5) {
                    clearInterval(interval);
                    resolve();
                }
            }, 10);
        });
        let message_objects = [];
        for (var i = 0; i < messages.length; i++) {
            try {
                let message = messages.item(i);
                let message_parts = message.childNodes.item(0);
                let message_parts_divs = message_parts.getElementsByTagName("div");
                let message_parts_container = await new Promise((resolve) => {
                    let interval = setInterval(() => {
                        for (var i = 0; i < message_parts_divs.length; i++) {
                            if (message_parts_divs.item(i).className == "msg-parts-container") {
                                clearInterval(interval);
                                resolve(message_parts_divs.item(i));
                            }
                        }
                    }, 10);
                });
                let message_part_with_menu = message_parts_container.childNodes.item(1);
                let message_part_router = message_part_with_menu.childNodes.item(0);
                let message_text_part = message_part_router.childNodes.item(0);
                let message_summary = message_text_part.ariaLabel;
                let part_content_container = await new Promise((resolve) => {
                    let interval = setInterval(() => {
                        for (var i = 0; i < message_parts_divs.length; i++) {
                            if (message_parts_divs.item(i).className == "part-content-container") {
                                clearInterval(interval);
                                resolve(message_parts_divs.item(i));
                            }
                        }
                    }, 10);
                });
                let message_part_content = part_content_container.childNodes.item(0);
                let text_message_content = message_part_content.childNodes.item(0);
                let text_message = text_message_content.childNodes.item(3);
                let message_body = text_message.innerText;
                let message_object = { summary: message_summary, text: message_body };
                message_objects.push(message_object);
            } catch (error) {
                console.log(error);
            }
        };
        return message_objects;
    });
    message_objects.reverse();
    return message_objects.slice(start, (end != -1 && end <  message_objects.length) ? end + 1 : undefined);
}

async function typeInInput(text, page) {
    return page.evaluate(async (text) => {
        await new Promise((resolve) => {
            let interval = setInterval(() => {
                let inputs = document.getElementsByTagName("input");
                if (inputs.length > 0) {
                    inputs[0].value = text;
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });
    }, text);
}

async function sendMessage(person, text, page) {
    //if cachedConversationIds doesn't have this person cached do this 
    if (!cachedConversationIds.has(person)) {
        await page.emulateIdleState({ isUserActive: true, isScreenUnlocked: true });
        await page.waitForSelector("input");
        await typeInInput(person, page);
        await page.type("input", " ");
        while (true) {
            let input = await (await page.$('input'));
            if (input != undefined) {
                input.press('Enter');
            } else {
                break;
            }
        }
    } else {
        gotoFast("/web/conversations/" + cachedConversationIds.get(person), page);
    }
    await page.waitForSelector(".input");
    //get the last part of the url and add it to the cachedConversationIds map with the person as the key
    let url = await page.evaluate(() => {
        return window.location.href;
    });
    cachedConversationIds.set(person, url.split("/").pop());
    await page.type(".input", text + "\n");
    await page.emulateIdleState({ isUserActive: false, isScreenUnlocked: false });
    // await (await page.$("a[href='/web/conversations/new']")).click();
    gotoFast("/web/conversations/new", page);
}

function gotoFast(url, page) {
    page.evaluate((url) => {
        //create a link element and click it
        let a = document.createElement("a");
        a.href = url;
        a.click();
    }, url);
}