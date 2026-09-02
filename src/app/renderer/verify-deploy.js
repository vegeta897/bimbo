const verifyButton = document.getElementById("verifyDeploy")
const form = document.getElementById("form")
const verificationResultText = document.getElementById("verificationResult")

verifyButton.addEventListener("click", async (event) => {
    event.preventDefault()
    verifyButton.disabled = true
    verificationResultText.innerHTML = `testing connection...`
    verificationResultText.className = "has-text-info"
    const formData = window.getFormData(form)
    const { success, message } = await window.electron.verifyDeploy(formData)
    verifyButton.disabled = false
    const resultMessage = success ? "success!" : message
    verificationResultText.innerHTML = resultMessage
    verificationResultText.className = success
        ? "has-text-success"
        : "has-text-danger"
})
