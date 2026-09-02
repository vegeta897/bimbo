const electron = require("electron") // need to use require() in web views

electron.contextBridge.exposeInMainWorld("electron", {
    formSubmission: (data) => electron.ipcRenderer.send("form", data),
    onStartersList: (callback) =>
        // TODO change this to data sent to an hbs
        // or, make it an invoke() to get the list instead of listening for it
        electron.ipcRenderer.on("starters-list", (_event, value) =>
            callback(value),
        ),
    pickDirectory: () => electron.ipcRenderer.invoke("pick-directory"),
    verifyDeploy: (deployConfig) =>
        electron.ipcRenderer.invoke("verify-deploy", deployConfig),
})
