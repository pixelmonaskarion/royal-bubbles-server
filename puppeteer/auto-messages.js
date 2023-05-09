import puppeteer from 'puppeteer';
import fs from "fs";
import startServer from "./server.js";

let cachedConversationIds = new Map();

(async () => {
    let saveOnExit = function () {
        console.log("saving");
        process.stdin.resume();
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
    process.on('SIGINT', saveOnExit);
    process.on('SIGUSR1', saveOnExit);
    process.on('SIGUSR2', saveOnExit);
    process.on('uncaughtException', (err) => {
        console.log("yo, the code crashed");
        console.error(err);
        saveOnExit();
    });

    let jsonCachedConversationIds = fs.readFileSync("cachedConversationIds.json");
    cachedConversationIds = new Map(JSON.parse(jsonCachedConversationIds));
    console.log("loaded cachedConversationIds: ", cachedConversationIds);

    const browser = await puppeteer.launch({ headless: false, userDataDir: "./user_data" });
    const page = await browser.newPage();
    await page.goto("https://messages.google.com/web/conversations/new");
    await page.setViewport({ width: 2080, height: 2024 });
    console.log("starting server...");
    startServer(async (person, start, end) => { return await getMessages(person, start, end, page) }, async (person, text) => { await sendMessage(person, text, page) }, async () => {return await findChats(page)});
})();

//"https://instantmessaging-pa.googleapis.com/$rpc/google.internal.communications.instantmessaging.v1.Messaging/SendMessage"
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/ReceiveMessages
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/PullMessages
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/AckMessages
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/PrewarmReceiver
// /$rpc/google.internal.communications.instantmessaging.v1.Messaging/Echo
// {X-Goog-Api-Key: "AIzaSyCA4RsOZUFrm9whhtGosPlJLmVPnfSHKz8"}

async function findChats(page) {
    return new Map(Object.entries(await page.evaluate(async () => {
        await new Promise((resolve) => {
            let interval = setInterval(() => {
                if (document.getElementsByTagName("mws-conversation-list-item").length > 0) {
                    clearInterval(interval);
                    resolve();
                }
            }, 10);
        });
        let conversations = document.getElementsByTagName("mws-conversation-list-item");
        let conversation_information = new Map();
        try {
            for (var i = 0; i < conversations.length; i++) {
                let conv_url_parts = conversations[i].firstChild.href.split("/");
                let conv_id = parseInt(conv_url_parts[conv_url_parts.length - 1]);
                let text_content = conversations[i].firstChild.getElementsByClassName("text-content");
                let h3 = text_content.item(0).firstChild;
                let span = h3.childNodes.item(2);
                let conv_name = span.textContent;
                conversation_information.set(conv_id, { name: conv_name });
            }
        } catch (e) {
            console.log("boohoo", e);
        }
        return Object.fromEntries(conversation_information);
    })).map(([k, v]) => [parseInt(k), v]));
}

async function getMessages(conversation, start, end, page) {
    if (typeof conversation === "string") {
        if (!cachedConversationIds.has(conversation)) {
            await page.emulateIdleState({ isUserActive: true, isScreenUnlocked: true });
            await page.waitForSelector("input");
            await typeInInput(conversation, page);
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
            gotoFast("/web/conversations/" + cachedConversationIds.get(conversation), page);
        }
    } else {
        gotoFast("/web/conversations/" + conversation, page);
    }
    await page.waitForSelector(".input");
    let message_objects = await page.evaluate(async () => {
        let messages = document.getElementsByTagName("mws-message-wrapper");
        await new Promise((resolve) => {
            let interval = setInterval(() => {
                console.log(messages.length);
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
                console.log(message_part_content.className);
                let incoming = message_part_content.className.includes(" incoming ")
                console.log(incoming);
                let text_message_content = message_part_content.childNodes.item(0);
                let text_message = text_message_content.childNodes.item(3);
                let message_body = text_message.innerText;
                let message_object = { summary: message_summary, text: message_body, incoming: incoming };
                message_objects.push(message_object);
            } catch (error) {
                console.log(error);
            }
        };
        return message_objects;
    });
    message_objects.reverse();
    return message_objects.slice(start, (end != -1 && end < message_objects.length) ? end + 1 : undefined);
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

async function sendMessage(conversation, text, page) {
    if (typeof conversation === "string") {
        if (!cachedConversationIds.has(conversation)) {
            await page.emulateIdleState({ isUserActive: true, isScreenUnlocked: true });
            gotoFast("/web/conversations/new", page);
            await page.waitForSelector("input");
            await typeInInput(conversation, page);
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
            gotoFast("/web/conversations/" + cachedConversationIds.get(conversation), page);
        }
    } else {
        gotoFast("/web/conversations/" + conversation, page);
    }
    await page.waitForSelector(".input");
    //get the last part of the url and add it to the cachedConversationIds map with the person as the key
    let url = await page.evaluate(() => {
        return window.location.href;
    });
    //cachedConversationIds.set(person, url.split("/").pop());
    await page.type(".input", text + "\n");
    await page.emulateIdleState({ isUserActive: false, isScreenUnlocked: false });
    return parseInt(url.split("/").pop());
    // await (await page.$("a[href='/web/conversations/new']")).click();
}

function gotoFast(url, page) {
    page.evaluate((url) => {
        //create a link element and click it
        let a = document.createElement("a");
        a.href = url;
        a.click();
    }, url);
}