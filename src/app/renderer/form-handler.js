function getFormData(form) {
    const formInputs = [...form.elements].filter((input) => input.id)
    const formData = Object.fromEntries(
        formInputs.map((input) => [input.id, input.value]),
    )
    return formData
}

function missingRequiredInputs(form) {
    const formInputs = [...form.elements].filter((input) => input.id)
    return formInputs.some((input) => input.required && input.value === "")
}

function sendForm(event) {
    event.preventDefault() // stop the form from submitting

    if (missingRequiredInputs(event.currentTarget)) {
        // do not submit if missing required inputs
        return
    }
    const formData = getFormData(event.currentTarget)

    window.electron.formSubmission(formData)
    window.close()
}
