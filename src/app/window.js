import * as path from "node:path"
import { fileURLToPath } from "url"
import { app, BrowserWindow } from "electron"
import { renderFormToHtml } from "../templater.js"
import { openExternalUrl } from "./electron.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RENDERER_PATH = path.join(__dirname, "renderer")

function createBrowserWindow() {
    const browserWindow = new BrowserWindow({
        useContentSize: true,
        alwaysOnTop: true, // reconsider, this can hide electron popups and errors
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    })
    if (!app.isPackaged) {
        browserWindow.webContents.openDevTools()
    }
    return browserWindow
}

export async function renderFormInWindow(formName, data = {}) {
    const browserWindow = createBrowserWindow()
    const html = await renderFormToHtml(formName, RENDERER_PATH, data)
    await browserWindow.loadURL(
        "data:text/html;charset=UTF-8," + encodeURIComponent(html),
        {
            baseURLForDataURL: `file://${RENDERER_PATH}/`,
        },
    )
    return browserWindow
}

export async function openPageInWindow(pageName) {
    const browserWindow = createBrowserWindow()
    await browserWindow.loadFile(
        path.join(RENDERER_PATH, "app", `${pageName}.html`),
    )
    return browserWindow
}

// redirect navigation and new windows to user's browser instead
app.on("web-contents-created", (event, webContents) => {
    // prevents navigation within BrowserWindow
    webContents.on("will-navigate", (event, navigationUrl) => {
        event.preventDefault()
        openExternalUrl(navigationUrl, webContents)
    })
    // prevents new BrowserWindow opening
    webContents.setWindowOpenHandler(({ url }) => {
        openExternalUrl(url, webContents)
        return { action: "deny" }
    })
})
