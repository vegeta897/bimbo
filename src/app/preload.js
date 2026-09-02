const electron = require("electron") // need to use require() in web views

electron.contextBridge.exposeInMainWorld("electron", {
    formSubmission: (data) => electron.ipcRenderer.send("form", data),
    onStartersList: (callback) =>
        // TODO change this to data sent to an hbs
        electron.ipcRenderer.on("starters-list", (_event, value) =>
            callback(value),
        ),
    pickDirectory: () => electron.ipcRenderer.invoke("pick-directory"),
    checkDeploy: (deployConfig) =>
        electron.ipcRenderer.invoke("check-deploy", deployConfig),
})
