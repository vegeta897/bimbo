// import _ from "lodash"

export default {
    // https://stackoverflow.com/a/34252942/2612679
    ifEquals: function (arg1, arg2, options) {
        return arg1 === arg2 ? options.fn(this) : options.inverse(this)
    },
}
