import express, { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as bodyParser from "body-parser";
import * as fs from "fs";

// Configurazione Firebase Admin SDK
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const app = express();
app.use(bodyParser.json());

const tokensFile = "./tokens.json";

// Funzione per salvare i token
const saveToken = (token: string) => {
    let tokens: string[] = [];
    if (fs.existsSync(tokensFile)) {
        tokens = JSON.parse(fs.readFileSync(tokensFile, "utf-8"));
    }
    if (!tokens.includes(token)) {
        tokens.push(token);
        fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    }
};

// Endpoint per registrare un token
app.post("/register", (req: Request, res: Response) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).send("Token mancante");
    }
    saveToken(token);
    res.send("Token salvato con successo");
});

// Endpoint per inviare notifiche
app.post("/send-notification", async (req: Request, res: Response) => {
    const { title, body } = req.body;
    if (!title || !body) {
        return res.status(400).send("Titolo o corpo della notifica mancanti");
    }

    if (!fs.existsSync(tokensFile)) {
        return res.status(400).send("Nessun token registrato");
    }

    const tokens: string[] = JSON.parse(fs.readFileSync(tokensFile, "utf-8"));
    const messages = tokens.map((token) => ({
        token,
        notification: { title, body },
    }));

    try {
        const response = await Promise.all(
            messages.map((message) => admin.messaging().send(message))
        );
        res.send(`Notifiche inviate con successo: ${response.length}`);
    } catch (error) {
        console.error("Errore nell'invio delle notifiche:", error);
        res.status(500).send("Errore nell'invio delle notifiche");
    }
});

// Avvio del server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server in esecuzione su http://localhost:${PORT}`);
});