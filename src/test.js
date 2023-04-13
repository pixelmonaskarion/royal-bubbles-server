setTimeout(async () => {
    let response = await fetch("http://127.0.0.1:8000/send_message", {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: "Hello World!", person: "5551234567" })
    });
    console.log(await response.text());
}, 1000);