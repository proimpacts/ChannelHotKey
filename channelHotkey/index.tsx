import { definePluginSettings } from "@api/Settings";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { openPluginModal } from "@components/settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelRouter, ChannelStore, Forms, Menu, TextInput, useEffect, UserStore, useState } from "@webpack/common";

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

const VOICE_CHANNEL_TYPES = new Set([2, 13]);
const GROUP_DM_TYPE = 3;
const DM_TYPE = 1;

const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"];
const MODIFIER_TOKENS = new Set(MODIFIER_ORDER);

interface Binding {
    hotkey: string;
    channelId: string;
}

function parseBindings(): Binding[] {
    try {
        const arr = JSON.parse(settings.store.bindingsJson || "[]");
        return Array.isArray(arr) ? arr.filter(b => b?.channelId) : [];
    } catch {
        return [];
    }
}

function saveBindings(next: Binding[]) {
    settings.store.bindingsJson = JSON.stringify(next);
}

function codeToToken(code: string): string {
    if (code.startsWith("Key")) return code.slice(3).toLowerCase();
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return code.slice(6).toLowerCase();
    if (code.startsWith("Arrow")) return code.slice(5).toLowerCase();
    if (code.startsWith("Control")) return "ctrl";
    if (code.startsWith("Shift")) return "shift";
    if (code.startsWith("Alt")) return "alt";
    if (code.startsWith("Meta") || code.startsWith("OS")) return "meta";
    if (code === "Space") return "space";
    return code.toLowerCase();
}

function comboString(tokens: Iterable<string>): string {
    const arr = [...new Set(tokens)];
    const mods = MODIFIER_ORDER.filter(m => arr.includes(m));
    const rest = arr.filter(t => !MODIFIER_TOKENS.has(t)).sort();
    return [...mods, ...rest].join("+");
}

function comboTokens(hotkey: string): string[] {
    return hotkey ? hotkey.split("+").filter(Boolean) : [];
}

function formatToken(token: string): string {
    if (token === "ctrl") return "Ctrl";
    if (token === "alt") return "Alt";
    if (token === "shift") return "Shift";
    if (token === "meta") return "Meta";
    if (token === "space") return "Space";
    return token.length === 1 ? token.toUpperCase() : token[0].toUpperCase() + token.slice(1);
}


function describeChannel(channelId: string): { label: string; icon: string; } {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return { label: "Unknown channel", icon: "❔" };

    if (VOICE_CHANNEL_TYPES.has(channel.type)) return { label: channel.name || "Voice Channel", icon: "🔊" };
    if (channel.type === DM_TYPE) {
        const user = UserStore.getUser(channel.recipients?.[0]);
        return { label: user ? `DM with ${user.username}` : "Direct Message", icon: "💬" };
    }
    if (channel.type === GROUP_DM_TYPE) return { label: channel.name || "Group DM", icon: "👥" };
    const name = channel.name ? channel.name.replace(/^#+/, "") : "Channel";
    return { label: `#${name}`, icon: "" };
}

const heldTokens = new Set<string>();
let lastCombo = "";

function resetHeldKeys() {
    heldTokens.clear();
    lastCombo = "";
}

function handleRuntimeKeyDown(e: KeyboardEvent) {
    heldTokens.add(codeToToken(e.code));
    const combo = comboString(heldTokens);
    if (combo === lastCombo) return;
    lastCombo = combo;

    const bindings = parseBindings();
    const binding = bindings.find(b => b.hotkey && b.hotkey === combo);
    if (!binding) return;

    const target = e.target as HTMLElement | null;
    const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (isTyping && !MODIFIER_ORDER.some(m => comboTokens(combo).includes(m))) return;

    const channel = ChannelStore.getChannel(binding.channelId);
    if (!channel) return;

    e.preventDefault();
    e.stopPropagation();

    if (VOICE_CHANNEL_TYPES.has(channel.type)) {
        selectVoiceChannel(binding.channelId);
    } else {
        ChannelRouter.transitionToChannel(binding.channelId);
    }
}

function handleRuntimeKeyUp(e: KeyboardEvent) {
    heldTokens.delete(codeToToken(e.code));
    lastCombo = comboString(heldTokens);
}

let pendingAutoRecordChannelId: string | null = null;

function assignHotkeyToChannel(channelId: string) {
    const current = parseBindings();
    if (!current.some(b => b.channelId === channelId)) {
        current.push({ hotkey: "", channelId });
        saveBindings(current);
    }
    pendingAutoRecordChannelId = channelId;
    openPluginModal(plugin);
}

type RecordTarget = number | "new" | null;

function HotkeyRecorder({ value, recording }: { value: string; recording: boolean; }) {
    const tokens = comboTokens(value);

    return (
        <div
            style={{
                display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
                minHeight: 30,
                marginTop: 6,
                color: "var(--text-normal)",
                fontSize: 12
            }}
        >
            {recording ? (
                <span style={{ opacity: 0.85, fontWeight: 700 }}>Press keys to record</span>
            ) : tokens.length ? (
                tokens.map((t, i) => (
                    <span
                        key={i}
                        style={{
                            padding: "6px 10px", borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "var(--background-tertiary)",
                            color: "var(--text-normal)",
                            fontSize: 12, fontWeight: 600
                        }}
                    >
                        {formatToken(t)}
                    </span>
                ))
            ) : (
                <span style={{ opacity: 0.65 }}>Not set</span>
            )}
        </div>
    );
}

function BindingCard({
    hotkey, channelId, recording, onToggleRecord, onChannelIdChange, onRemove
}: {
    hotkey: string;
    channelId: string;
    recording: boolean;
    onToggleRecord: () => void;
    onChannelIdChange: (v: string) => void;
    onRemove?: () => void;
}) {
    const { label, icon } = channelId ? describeChannel(channelId) : { label: "", icon: "" };
    const channelLabel = channelId ? `${icon ? `${icon} ` : ""}${label}` : "Paste a channel ID, or right click a channel and choose Set Channel Hotkey.";

    return (
        <div
            style={{
                display: "grid", gap: 16,
                padding: 18, marginBottom: 12,
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
                background: "var(--background-secondary)"
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{channelId ? "Channel Binding" : "New binding"}</div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4, maxWidth: 600 }}>{channelLabel}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={recording ? Button.Colors.RED : Button.Colors.BRAND}
                        onClick={onToggleRecord}
                    >
                        {recording ? "Cancel" : "Record"}
                    </Button>
                    {onRemove && (
                        <Button color={Button.Colors.RED} size={Button.Sizes.SMALL} onClick={onRemove}>
                            Remove
                        </Button>
                    )}
                </div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
                <TextInput
                    value={channelId}
                    placeholder="Channel ID"
                    onChange={onChannelIdChange}
                    style={{ width: "100%" }}
                />
                {channelId && (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                        Hotkey: <strong>{hotkey || "Not set"}</strong>
                    </div>
                )}
            </div>
            <HotkeyRecorder value={hotkey} recording={recording} />
        </div>
    );
}

function BindingsSetting() {
    const [bindings, setBindings] = useState<Binding[]>(parseBindings);
    const [newHotkey, setNewHotkey] = useState("");
    const [newChannelId, setNewChannelId] = useState("");
    const [recording, setRecording] = useState<RecordTarget>(null);

    function save(next: Binding[]) {
        setBindings(next);
        saveBindings(next);
    }

    useEffect(() => {
        if (!pendingAutoRecordChannelId) return;
        const idx = bindings.findIndex(b => b.channelId === pendingAutoRecordChannelId);
        pendingAutoRecordChannelId = null;
        if (idx !== -1) setRecording(idx);
    }, []);

    useEffect(() => {
        if (recording === null) return;

        const heldTokens = new Set<string>();
        const recordedTokens = new Set<string>();
        let ctrlPressed = false;
        let captured = false;

        function commit() {
            if (captured) return;
            if (heldTokens.size !== 0) return;
            if (!ctrlPressed) return;
            const nonModifier = [...recordedTokens].some(t => !MODIFIER_TOKENS.has(t));
            if (!nonModifier) return;
            captured = true;

            const combo = comboString(recordedTokens);
            if (recording === "new") {
                setNewHotkey(combo);
            } else {
                setBindings(prev => {
                    const next = [...prev];
                    next[recording as number] = { ...next[recording as number], hotkey: combo };
                    saveBindings(next);
                    return next;
                });
            }
            setRecording(null);
        }

        function onKeyDown(e: KeyboardEvent) {
            const token = codeToToken(e.code);
            if (e.key === "Escape") {
                setRecording(null);
                return;
            }

            if (token === "ctrl") {
                ctrlPressed = true;
                heldTokens.add(token);
                recordedTokens.add(token);
            } else if (!ctrlPressed) {
                return;
            } else {
                heldTokens.add(token);
                recordedTokens.add(token);
            }

            e.preventDefault();
            e.stopPropagation();
        }

        function onKeyUp(e: KeyboardEvent) {
            const token = codeToToken(e.code);
            if (heldTokens.has(token)) {
                heldTokens.delete(token);
            }
            e.preventDefault();
            e.stopPropagation();
            commit();
        }

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
        };
    }, [recording]);

    return (
        <Forms.FormSection style={{ padding: 26, gap: 20, background: "rgba(255,255,255,0.03)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "grid", gap: 6 }}>
                <Forms.FormTitle>ChannelHotkey</Forms.FormTitle>
                <Forms.FormText style={{ marginBottom: 0, opacity: 0.78, lineHeight: 1.6, fontSize: 13 }}>
                    Use Control + keys to jump to a channel or join voice. Right click a channel, DM, group DM, or voice channel and choose "Set Channel Hotkey" to assign it.
                </Forms.FormText>
            </div>

            {bindings.map((b, i) => (
                <BindingCard
                    key={i}
                    hotkey={b.hotkey}
                    channelId={b.channelId}
                    recording={recording === i}
                    onToggleRecord={() => setRecording(recording === i ? null : i)}
                    onChannelIdChange={v => {
                        const next = [...bindings];
                        next[i] = { ...next[i], channelId: v.trim() };
                        save(next);
                    }}
                    onRemove={() => {
                        if (recording === i) setRecording(null);
                        save(bindings.filter((_, j) => j !== i));
                    }}
                />
            ))}

            <Forms.FormDivider style={{ margin: "16px 0" }} />
            <div style={{ display: "grid", gap: 10 }}>
                <Forms.FormTitle tag="h5">Add a new binding</Forms.FormTitle>
                <BindingCard
                    hotkey={newHotkey}
                    channelId={newChannelId}
                    recording={recording === "new"}
                    onToggleRecord={() => setRecording(recording === "new" ? null : "new")}
                    onChannelIdChange={setNewChannelId}
                />
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.BRAND}
                        disabled={!newHotkey.trim() || !/^\d{15,21}$/.test(newChannelId.trim())}
                        onClick={() => {
                            save([...bindings, { hotkey: newHotkey.trim(), channelId: newChannelId.trim() }]);
                            setNewHotkey("");
                            setNewChannelId("");
                        }}
                    >
                        Add Binding
                    </Button>
                </div>
            </div>
        </Forms.FormSection>
    );
}

const settings = definePluginSettings({
    bindingsJson: {
        type: OptionType.CUSTOM,
        default: "[]"
    },
    bindingsComponent: {
        type: OptionType.COMPONENT,
        component: BindingsSetting
    }
});

const channelContextMenuPatch: NavContextMenuPatchCallback = (children, props: { channel?: { id: string; }; }) => {
    if (!props?.channel?.id) return;
    const channelId = props.channel.id;

    const group = findGroupChildrenByChildId("mark-channel-read", children)
        ?? findGroupChildrenByChildId("close-dm", children)
        ?? findGroupChildrenByChildId("leave-channel", children);

    const item = (
        <Menu.MenuItem
            id="vc-channel-hotkey-set"
            label="Set Channel Hotkey"
            action={() => assignHotkeyToChannel(channelId)}
        />
    );

    if (group) group.push(item);
    else children.push(item);
};

const plugin = definePlugin({
    name: "ChannelHotkey",
    description: "Bind keyboard shortcuts to instantly jump to a channel, DM, or join a voice channel. Right click a channel to set one up.",
    authors: [{ name: "proimpacts", url: "https://github.com/proimpacts.", id: 1176652779973001256n }],
    settings,

    contextMenus: {
        "channel-context": channelContextMenuPatch,
        "thread-context": channelContextMenuPatch,
        "gdm-context": channelContextMenuPatch,
        "user-context": channelContextMenuPatch
    },

    start() {
        document.addEventListener("keydown", handleRuntimeKeyDown, true);
        document.addEventListener("keyup", handleRuntimeKeyUp, true);
        window.addEventListener("blur", resetHeldKeys);
        document.addEventListener("visibilitychange", resetHeldKeys);
    },

    stop() {
        document.removeEventListener("keydown", handleRuntimeKeyDown, true);
        document.removeEventListener("keyup", handleRuntimeKeyUp, true);
        window.removeEventListener("blur", resetHeldKeys);
        document.removeEventListener("visibilitychange", resetHeldKeys);
        resetHeldKeys();
    }
});

export default plugin;