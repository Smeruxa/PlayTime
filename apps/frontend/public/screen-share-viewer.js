(() => {
    const api = window.screenShareViewer;
    if (!api) return;
    const img = document.getElementById("frame"), overlay = document.getElementById("overlay"), mixer = document.getElementById("mixer"), toggle = document.getElementById("mixerToggle");
    const rows = new Map(), remembered = new Map();
    let idleTimer, pendingUrl, rafId, rowId = 0;
    function showOverlay() {
        overlay.classList.add("visible"); document.body.style.cursor = "default";
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (!mixer.hidden || overlay.matches(":hover") || overlay.contains(document.activeElement)) return;
            overlay.classList.remove("visible"); document.body.style.cursor = "none";
        }, 2200);
    }
    function setMixer(open) {
        mixer.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); showOverlay();
        if (open) mixer.querySelector("input:not(:disabled)")?.focus();
    }
    const speaker = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
    function row(key, labelText, value, disabled, change, container) {
        let channel = rows.get(key);
        if (!channel) {
            const root = document.createElement("div"), head = document.createElement("div"), label = document.createElement("label"), output = document.createElement("output"), mute = document.createElement("button"), input = document.createElement("input");
            root.className = "channel"; head.className = "channelHead"; input.type = "range"; input.min = "0"; input.max = "100"; input.step = "1"; input.id = "mixer-channel-" + (++rowId); label.htmlFor = input.id; output.setAttribute("for",input.id);
            mute.type = "button"; mute.className = "mute"; mute.innerHTML = speaker;
            head.append(label, output, mute); root.append(head, input); container.append(root);
            channel = { root, label, output, mute, input, change }; rows.set(key,channel);
            const apply = value => { channel.input.value = String(value); channel.input.style.setProperty("--level", value + "%"); channel.output.textContent = value + "%"; channel.mute.setAttribute("aria-pressed",String(value === 0)); if (value > 0) remembered.set(key,value); channel.change(value); showOverlay(); };
            input.addEventListener("input", () => apply(Number(input.value)));
            mute.addEventListener("click", () => apply(Number(input.value) > 0 ? 0 : remembered.get(key) || 100));
        }
        channel.change = change; channel.label.textContent = labelText; channel.input.setAttribute("aria-label", labelText); channel.output.textContent = value + "%";
        if (document.activeElement !== channel.input) channel.input.value = String(value);
        channel.input.style.setProperty("--level", value + "%"); channel.input.disabled = disabled; channel.mute.disabled = disabled; channel.root.classList.toggle("disabled",disabled);
        channel.mute.setAttribute("aria-pressed",String(value === 0)); channel.mute.setAttribute("aria-label",(value === 0 ? "Включить: " : "Выключить: ") + labelText);
        if (value > 0) remembered.set(key,value);
    }
    api.onMixer(state => {
        const keep = new Set(); document.getElementById("emptyMixer").hidden = !!state;
        if (state) {
            const main = document.getElementById("mainChannels");
            row("screen",state.screenLabel,state.screenMuted ? 0 : state.screen,!state.screenAvailable,value=>api.changeMixer({kind:"screen",value}),main); keep.add("screen");

        }
        for (const [key, channel] of rows) if (!keep.has(key)) { channel.root.remove(); rows.delete(key); remembered.delete(key); }
    });
    api.requestMixer();
    api.onFrame(url => {
        pendingUrl = url;
        if (rafId != null) return;
        rafId = requestAnimationFrame(() => { rafId = null; if (pendingUrl) { img.src = pendingUrl; pendingUrl = null; } });
    });
    toggle.addEventListener("click", () => setMixer(mixer.hidden));
    document.getElementById("hideMixer").addEventListener("click", () => { setMixer(false); toggle.focus(); });
    document.getElementById("closeBtn").addEventListener("click", () => api.close());
    document.addEventListener("keydown", event => {
        showOverlay();
        if (event.key === "Escape") { if (!mixer.hidden) { setMixer(false); toggle.focus(); } else api.close(); }
    });
    document.addEventListener("mousemove", showOverlay);
    document.addEventListener("mousedown", event => { showOverlay(); if (!overlay.contains(event.target)) setMixer(false); });
    overlay.addEventListener("focusout", showOverlay);
    showOverlay();
})();
