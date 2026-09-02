const checkButton = document.getElementById("checkDeploy")
const form = document.getElementById("form")
const deployCheckResultText = document.getElementById("checkResult")

checkButton.addEventListener("click", async (event) => {
    event.preventDefault()
    checkButton.disabled = true
    deployCheckResultText.innerHTML = `testing connection...`
    deployCheckResultText.className = "has-text-info"
    const formData = window.getFormData(form)
    const { success, message } = await window.electron.checkDeploy(formData)
    checkButton.disabled = false
    const resultMessage = success ? "success!" : message
    deployCheckResultText.innerHTML = resultMessage
    deployCheckResultText.className = success
        ? "has-text-success"
        : "has-text-danger"
})
