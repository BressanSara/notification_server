import express, { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as fs from "fs";
import axios from "axios";

// Configurazione Firebase Admin SDK
const serviceAccount = {
    type: process.env.type,
    project_id: process.env.project_id,
    private_key_id: process.env.private_key_id,
    private_key: process.env.private_key?.replace(/\\n/g, "\n"),
    client_email: process.env.client_email,
    client_id: process.env.client_id,
    auth_uri: process.env.auth_uri,
    token_uri: process.env.token_uri,
    auth_provider_x509_cert_url: process.env.token_uri,
    client_x509_cert_url: process.env.client_x509_cert_url,
    universe_domain: process.env.universe_domain,
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

const app = express();
app.use(express.json());

const tokensFile = "./tokens.json";
const remindersFile = "./reminders.json";

// Funzione per ottenere la chiave API
const getApiKey = (): string => {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
        throw new Error("Chiave API non trovata nelle variabili d'ambiente");
    }
    return apiKey;
};

// Funzione per leggere un file JSON
const readFile = (filePath: string): any[] => {
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    return [];
};

// Funzione per scrivere un file JSON
const writeFile = (filePath: string, data: any[]) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// Endpoint per registrare un token
app.post("/register", (req: Request, res: Response) => {
    const { token } = req.body;
    if (!token) return res.status(400).send("Token mancante");

    const tokens = readFile(tokensFile);
    if (!tokens.includes(token)) {
        tokens.push(token);
        writeFile(tokensFile, tokens);
    }
    res.send("Token salvato con successo");
});

// Endpoint per inviare notifiche
app.post("/send-notification", async (req: Request, res: Response) => {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).send("Titolo o corpo della notifica mancanti");

    const tokens = readFile(tokensFile);
    if (tokens.length === 0) return res.status(400).send("Nessun token registrato");

    const messages = tokens.map((token) => ({
        token,
        notification: { title, body },
    }));

    try {
        await Promise.all(messages.map((message) => admin.messaging().send(message)));
        res.send("Notifiche inviate con successo");
    } catch (error) {
        console.error("Errore nell'invio delle notifiche:", error);
        res.status(500).send("Errore nell'invio delle notifiche");
    }
});

// Endpoint per aggiungere un reminder
app.post("/reminders", (req: Request, res: Response) => {
    const { id, locationName, lat, lon, threshold, isMax } = req.body;
    if (!id || !lat || !lon || threshold === undefined || isMax === undefined) {
        return res.status(400).send("Dati mancanti");
    }

    const reminders = readFile(remindersFile);
    const newReminder = { id, locationName, lat, lon, threshold, isMax };
    reminders.push(newReminder);
    writeFile(remindersFile, reminders);

    res.status(201).send(newReminder);
});

// Endpoint per ottenere tutti i reminder
app.get("/reminders", (req: Request, res: Response) => {
    const reminders = readFile(remindersFile);
    if (reminders.length === 0) return res.status(404).send("Nessun reminder trovato");
    res.send(reminders);
});

// Endpoint per aggiornare un reminder
app.put("/reminders/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const { locationName, lat, lon, threshold, isMax } = req.body;

    const reminders = readFile(remindersFile);
    const reminder = reminders.find((r) => r.id === id);
    if (!reminder) return res.status(404).send("Reminder non trovato");

    if (lat) reminder.lat = lat;
    if (lon) reminder.lon = lon;
    if (locationName) reminder.locationName = locationName;
    if (threshold !== undefined) reminder.threshold = threshold;
    if (isMax !== undefined) reminder.isMax = isMax;

    writeFile(remindersFile, reminders);
    res.send(reminder);
});

// Endpoint per eliminare un reminder
app.delete("/reminders/:id", (req: Request, res: Response) => {
    const { id } = req.params;

    const reminders = readFile(remindersFile);
    const updatedReminders = reminders.filter((r) => r.id !== id);
    if (reminders.length === updatedReminders.length) {
        return res.status(404).send("Reminder non trovato");
    }

    writeFile(remindersFile, updatedReminders);
    res.status(204).send();
});

// Funzione per controllare le condizioni meteo e inviare notifiche
const checkWeatherAndNotify = async () => {
    const reminders = readFile(remindersFile);
    const OPENWEATHER_API_KEY = getApiKey();

    for (const reminder of reminders) {
        const { locationName, lat, lon, threshold, isMax } = reminder;

        try {
            const response = await axios.get(
                `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_API_KEY}`
            );
            const currentTemp = response.data.main.temp;

            if (
                (isMax && currentTemp > threshold) ||
                (!isMax && currentTemp < threshold)
            ) {
                const tokens = readFile(tokensFile);
                if (tokens.length === 0) {
                    console.error("Nessun token registrato per inviare la notifica");
                } else {
                    for (const token of tokens) {
                        await admin.messaging().send({
                            token: token,
                            notification: {
                                title: "Allerta Meteo",
                                body: `La temperatura è ${currentTemp}°C a ${locationName}, superando la soglia impostata.`,
                            },
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Errore nel controllo meteo o invio notifica:", error);
        }
    }
};

// Avvio del controllo periodico ogni 10 minuti
setInterval(checkWeatherAndNotify, 10 * 60 * 1000);

// Avvio del server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server in esecuzione sulla porta ${PORT}`);
});