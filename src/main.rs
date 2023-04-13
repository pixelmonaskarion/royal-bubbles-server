use std::{
    convert::Infallible,
    net::SocketAddr,
    sync::{
        mpsc::{channel, Sender},
        Arc, Mutex,
    },
    time::Duration,
};

use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use warp::{
    ws::{WebSocket, Ws},
    Filter, Rejection, Reply,
};

async fn backend_events(state_arc: Arc<Mutex<State>>, wb: Ws) -> Result<impl Reply, Rejection> {
    let (sender, receiver) = channel::<(Message, Sender<Status>)>();
    let mut state = state_arc.lock().unwrap();
    state.sender = Some(sender);
    println!("backend connected");
    return Ok(wb.on_upgrade(move |mut websocket: WebSocket| async move {
        loop {
            let message = receiver.recv();
            if message.is_ok() {
                match websocket.start_send_unpin(warp::ws::Message::text(format!(
                    "{{\"message\":{}}}",
                    serde_json::to_string(&message.as_ref().unwrap().0).unwrap()
                ))) {
                    Ok(_) => {
                        let response = websocket.next().await;
                        if response.is_none() {
                            println!("backend closed without sending a response!");
                            let _ = message.as_ref().unwrap().1.send(Status::DISCONNECTED);
                            break;
                        }
                        match response.unwrap() {
                            Ok(response_message) => {
                                println!("{response_message:?}");
                                let response_status = Status::from(response_message.to_str().unwrap());
                                let _ = message.as_ref().unwrap().1.send(response_status);
                            }
                            Err(e) => {
                                println!("failed to receive response! {e}");
                                let _ = message.as_ref().unwrap().1.send(Status::DISCONNECTED);
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        println!("failed to send message! {e}");
                        let _ = message.as_ref().unwrap().1.send(Status::DISCONNECTED);
                        break;
                    }
                };
            } else {
                println!("stream closed on sending side!");
                break;
            }
        }
    }));
}

pub fn send_message(state_arc: Arc<Mutex<State>>, message: Message) -> &'static str {
    let mut state = state_arc.lock().unwrap();
    let sender_option: &Option<Sender<(Message, Sender<Status>)>> = &state.sender;
    if sender_option.is_some() {
        let sender = sender_option.as_ref().unwrap();
        let (return_sender, return_receiver) = channel::<Status>();
        match sender.send((message, return_sender)) {
            Ok(_) => {
                println!("sent message")
            }
            Err(e) => {
                eprintln!("error forwarding message to backend {e}");
                state.sender = None;
                return Status::DISCONNECTED.into();
            }
        };
        let status_result = return_receiver.recv_timeout(Duration::from_secs(10));
        if status_result.is_ok() {
            return status_result.unwrap().into();
        }
        return Status::TIMEOUT.into();
    } else {
        println!("FAILED TO SEND MESSAGE: NO APP CONNECTED");
        return Status::DISCONNECTED.into();
    }
}

#[derive(Clone)]
pub struct State {
    sender: Option<Sender<(Message, Sender<Status>)>>,
}

#[derive(Clone)]
pub enum Status {
    SUCCESS,
    FAILURE,
    DISCONNECTED,
    TIMEOUT,
}

impl Into<&'static str> for Status {
    fn into(self) -> &'static str {
        match self {
            Self::SUCCESS => "Success",
            Self::DISCONNECTED => "Disconnected",
            Self::FAILURE => "Failure",
            Self::TIMEOUT => "Timeout",
        }
    }
}

impl From<&str> for Status {
    fn from(value: &str) -> Self {
        match value {
            "Success" => Self::SUCCESS,
            "Disconnected" => Self::DISCONNECTED,
            "Failure" => Self::FAILURE,
            "Timeout" => Self::TIMEOUT,
            _ => Self::FAILURE,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Message {
    text: String,
    person: String,
}

#[tokio::main]
pub async fn main() {
    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(["GET", "POST"]);
    let state = Arc::new(Mutex::new(State { sender: None }));
    let send_message_route = warp::path!("send_message")
        .and(with_state(state.clone()))
        .and(warp::body::json())
        .map(|state, message: Message| {
            return send_message(state, message);
        })
        .with(cors.clone());
    let gm_backend_route = warp::path!("backend")
        .and(with_state(state.clone()))
        .and(warp::ws())
        .and_then(|state, ws: Ws| async {
            return backend_events(state, ws).await;
        })
        .with(cors.clone());
    let addr: SocketAddr = "0.0.0.0:8000".parse().unwrap();

    println!("starting warp server");
    warp::serve(
        send_message_route
        .or(gm_backend_route)
    ).run(addr)
        .await;
}

fn with_state(
    server: Arc<Mutex<State>>,
) -> impl Filter<Extract = (Arc<Mutex<State>>,), Error = Infallible> + Clone {
    warp::any().map(move || server.clone())
}

/*
fetch("http://127.0.0.1:8000/send_message", {method: "POST", headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
                                            body: '{"text":"Hello World", "person": "christopher@huntwork.net"}'}); */
