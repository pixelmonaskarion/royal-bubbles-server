import http from "http";
import fs from "fs";
import {URL} from "url";
import { WebSocketServer } from 'ws';

export default function startServer(getMessages, sendMessage, findChats) {
	const server = http.createServer(async (req, res) => {
		if (req.url === '/') {
			fs.readFile('index.html', (err, data) => {
				if (err) {
					res.writeHead(500);
					return res.end('Error loading index.html');
				}

				res.writeHead(200);
				res.end(data);
			});
		} else {
			if (req.url == "/post-message") {
				if (req.method == "POST") {
					let body = [];
					req.on('data', (chunk) => {
						body.push(chunk);
					}).on('end', async () => {
						body = Buffer.concat(body).toString();
						let post = JSON.parse(body);
						console.log(post);
						await sendMessage(post.person, post.text);
						res.writeHead(200);
						res.end();
					});
					res.writeHead(200);
					res.end();
				} else {
					res.writeHead(405);
					res.end();
				}
			} else if (req.url.startsWith("/get-messages/")) {
				if (req.method == "GET") {
					let url = new URL("https://ifihadawebsiteiwouldputithere.com"+req.url);
					let paths = url.pathname.split("/");
					let person = decodeURI(paths[paths.length-1]);
					let start = url.searchParams.get("start");
					let end = url.searchParams.get("end");
					let messages = await getMessages(person, (start == undefined) ? 0 : start, (end == undefined) ? -1 : end);
					res.writeHead(200);
					res.end(JSON.stringify(messages));
				} else {
					res.writeHead(405);
					res.end();
				}
			} else if (req.url.startsWith("/get-chats/")) {
				if (req.method == "GET") {
					let chats = await findChats();
					console.log(chats);
					res.writeHead(200);
					res.end(JSON.stringify(Array.from(chats)));
				} else {
					res.writeHead(405);
					res.end();
				}
			} else {
				res.writeHead(404);
				res.end();
			}
		}
	});
	const wss = new WebSocketServer({ server, path: '/socket' });

	wss.on('connection', (ws) => {
		console.log('WebSocket connection established');

		ws.on('message', (message) => {
			console.log(`Received message: ${message}`);

			// Handle incoming messages here
		});

		ws.on('close', () => {
			console.log('WebSocket connection closed');
		});
	});

	server.listen(1234, () => {
		console.log('Server listening on http://localhost:3000');
	});
}