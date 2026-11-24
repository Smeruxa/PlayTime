function percent(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}
function mixerState(value) {
    if (!value || !percent(value.screen) || typeof value.screenMuted !== "boolean" || typeof value.screenAvailable !== "boolean") return null;
    if (typeof value.screenLabel !== "string" || value.screenLabel.length > 80) return null;
    return { screen: value.screen, screenMuted: value.screenMuted, screenAvailable: value.screenAvailable, screenLabel: value.screenLabel };
}
function mixerChange(value, state) {
    if (!state || !value || !percent(value.value)) return null;
    if (value.kind === "screen" && state.screenAvailable) return { kind: "screen", value: value.value };
    return null;
}
module.exports = { mixerState, mixerChange };
