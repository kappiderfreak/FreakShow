#Requires AutoHotkey v2.0
#SingleInstance Off

; FreakShow – gemeinsame Game-Control-Engine.
; Args:
; 1 = keys             z. B. W oder CTRL/W
; 2 = durationMs       z. B. 5000
; 3 = tapAfter         true/false oder 1/0
; 4 = blockPhysical    true/false oder 1/0
; 5 = actionMode       hold/repeat/tap/block
; 6 = repeatIntervalMs Abstand zwischen wiederholten Ausloesungen
; 7 = cancelFlagPath   interne Abbruchdatei der FreakShow-Bridge
; Mehrere Tasten in Argument 1 werden gemeinsam gedrueckt, z. B. CTRL/W.

rawKeyText         := A_Args.Length >= 1 ? Trim(A_Args[1]) : ""
holdMs             := A_Args.Length >= 2 ? (A_Args[2] + 0) : 5000
tapAfter           := A_Args.Length >= 3 ? ToBool(A_Args[3]) : false
blockPhysical      := A_Args.Length >= 4 ? ToBool(A_Args[4]) : true
actionMode         := A_Args.Length >= 5 ? StrLower(Trim(A_Args[5])) : "hold"
repeatIntervalMs   := A_Args.Length >= 6 ? (A_Args[6] + 0) : 100
global cancelFlagPath := A_Args.Length >= 7 ? Trim(A_Args[7]) : ""
global runCancelled := false

if (actionMode != "repeat" && actionMode != "tap" && actionMode != "block")
    actionMode := "hold"
if (actionMode = "block") {
    blockPhysical := true
    tapAfter := false
}
repeatIntervalMs := Max(25, Min(2000, repeatIntervalMs))

global accidentalCount := 0
global activeSingleHotkeys := []
global activeComboHotkeys := []

Log(msg) {
    logDir := A_ScriptDir "\..\Logs"
    if !DirExist(logDir)
        DirCreate(logDir)
    FileAppend FormatTime(, "yyyy-MM-dd HH:mm:ss") " | " msg "`n", logDir "\game-control.log", "UTF-8"
}

ToBool(value) {
    value := StrLower(Trim(value))
    return (value = "true" || value = "1" || value = "yes" || value = "on")
}

CancelRequested() {
    global cancelFlagPath, runCancelled
    if runCancelled
        return true
    if (cancelFlagPath = "")
        return false
    ; Die Bridge loescht die zu dieser Instanz gehoerende Laufdatei beim Stoppen.
    ; So funktioniert der Abbruch unabhaengig von PowerShell-Encoding/BOM sofort.
    if !FileExist(cancelFlagPath) {
        runCancelled := true
        return true
    }
    return false
}

SleepCancelable(durationMs, stepMs := 10) {
    durationMs := Max(0, durationMs)
    deadline := A_TickCount + durationMs
    while (A_TickCount < deadline) {
        if CancelRequested()
            return false
        Sleep Min(stepMs, deadline - A_TickCount)
    }
    return !CancelRequested()
}

NormalizeKeyName(name) {
    name := StrUpper(Trim(name))

    switch name {
        case "ESCAPE":
            return "ESC"
        case "RETURN":
            return "ENTER"
        case "SPACEBAR":
            return "SPACE"
        case "CONTROL", "CTRL", "STRG", "LCONTROL":
            return "LCTRL"
        case "RCONTROL":
            return "RCTRL"
        case "SHIFT":
            return "LSHIFT"
        case "ALT", "LMENU":
            return "LALT"
        case "RMENU":
            return "RALT"
        case "ARROWUP":
            return "UP"
        case "ARROWDOWN":
            return "DOWN"
        case "ARROWLEFT":
            return "LEFT"
        case "ARROWRIGHT":
            return "RIGHT"
        case "PAGEUP":
            return "PGUP"
        case "PAGEDOWN":
            return "PGDN"
        default:
            return name
    }
}

IsValidSingleKey(name) {
    ; A-Z / 0-9
    if RegExMatch(name, "^[A-Z0-9]$")
        return true

    ; F1-F24
    if RegExMatch(name, "^F([1-9]|1[0-9]|2[0-4])$")
        return true

    ; Physische Tastaturpositionen für ISO-/ANSI-Sondertasten
    if RegExMatch(name, "^SC[0-9A-F]{3}$")
        return true

    ; häufige Sondertasten
    static allowed := Map(
        "UP", true,
        "DOWN", true,
        "LEFT", true,
        "RIGHT", true,
        "SPACE", true,
        "ENTER", true,
        "TAB", true,
        "ESC", true,
        "BACKSPACE", true,
        "DELETE", true,
        "INSERT", true,
        "HOME", true,
        "END", true,
        "PGUP", true,
        "PGDN", true,
        "LCTRL", true,
        "RCTRL", true,
        "LALT", true,
        "RALT", true,
        "LSHIFT", true,
        "RSHIFT", true
    )

    return allowed.Has(name)
}

ParseKeyList(listText) {
    arr := []
    if (Trim(listText) = "")
        return arr

    for _, rawPart in StrSplit(listText, "/") {
        part := NormalizeKeyName(rawPart)
        if (part != "" && !ArrayContains(arr, part))
            arr.Push(part)
    }

    return arr
}

ArrayContains(arr, value) {
    for _, item in arr {
        if (item = value)
            return true
    }
    return false
}

BlockSingleKey(*) {
    global accidentalCount
    accidentalCount += 1
}

ComboOtherKeysHeld(currentKey, keys, *) {
    for _, keyName in keys {
        if (keyName != currentKey && !GetKeyState(keyName, "P"))
            return false
    }
    return true
}

PressTargetKeys(keys) {
    for _, keyName in keys
        SendEvent "{" keyName " down}"
}

ReleaseTargetKeys(keys) {
    Loop keys.Length {
        keyName := keys[keys.Length - A_Index + 1]
        SendEvent "{" keyName " up}"
    }
}

TapTargetKeys(keys, pressMs := 35) {
    if CancelRequested()
        return false
    PressTargetKeys(keys)
    completed := SleepCancelable(pressMs)
    ReleaseTargetKeys(keys)
    return completed && !CancelRequested()
}

; ===== Tasten parsen =====
targetKeys := ParseKeyList(rawKeyText)

; ===== Grundlogik =====
hasKeys := (targetKeys.Length > 0)

if !hasKeys {
    Log("ABORT | no key")
    ExitApp
}

; ===== Key-Validierung nur wenn key gesetzt ist =====
if hasKeys {
    for _, keyName in targetKeys {
        if !IsValidSingleKey(keyName) {
            Log("ABORT | invalid target key: " keyName)
            ExitApp
        }
    }
}

try {
    completed := true
    ; ===== Physische Ziel-Tasten blocken =====
    if (hasKeys && blockPhysical) {
        if (actionMode = "block" && targetKeys.Length > 1) {
            ; Jede Taste bleibt einzeln nutzbar. Erst die Taste, welche die
            ; vollstaendige Kombination herstellt, wird unterdrueckt.
            ; Key-Up wird bewusst nicht blockiert, damit in Spielen keine
            ; zuvor durchgelassene Taste haengen bleiben kann.
            for _, keyName in targetKeys {
                criterion := ComboOtherKeysHeld.Bind(keyName, targetKeys)
                comboDown := "$*" . keyName
                HotIf(criterion)
                Hotkey(comboDown, BlockSingleKey, "On")
                activeComboHotkeys.Push([criterion, comboDown])
            }
            HotIf()
        } else {
            for _, keyName in targetKeys {
                singleDown := "$*" . keyName
                singleUp   := "$*" . keyName . " Up"

                Hotkey(singleDown, BlockSingleKey, "On")
                Hotkey(singleUp,   BlockSingleKey, "On")

                activeSingleHotkeys.Push(singleDown)
                activeSingleHotkeys.Push(singleUp)
            }
        }
    }

    start := A_TickCount
    if CancelRequested() {
        completed := false
    } else if (actionMode = "block") {
        ; ===== Nur physische Ziel-Tasten blockieren, selbst nichts senden =====
        completed := SleepCancelable(holdMs)
    } else if (actionMode = "tap") {
        ; ===== Einmal ausloesen; optional nach Ablauf erneut tippen zum Zuruecksetzen =====
        completed := TapTargetKeys(targetKeys, 50)
        if completed
            completed := SleepCancelable(Max(0, holdMs - (A_TickCount - start)))
    } else if (actionMode = "repeat") {
        ; ===== Tasten/Tastenkombination bis zum Ablauf fortlaufend ausloesen =====
        pressMs := Min(50, Max(10, Floor(repeatIntervalMs / 2)))
        while (A_TickCount - start < holdMs) {
            if CancelRequested() {
                completed := false
                break
            }
            remaining := holdMs - (A_TickCount - start)
            if !TapTargetKeys(targetKeys, Min(pressMs, Max(1, remaining))) {
                completed := false
                break
            }
            remaining := holdMs - (A_TickCount - start)
            if (remaining <= 0)
                break
            if !SleepCancelable(Min(Max(1, repeatIntervalMs - pressMs), remaining)) {
                completed := false
                break
            }
        }
    } else {
        ; ===== Tasten/Tastenkombination fuer die Dauer gedrueckt halten =====
        PressTargetKeys(targetKeys)
        while (A_TickCount - start < holdMs) {
            if CancelRequested() {
                completed := false
                break
            }
            for _, keyName in targetKeys {
                if !GetKeyState(keyName)
                    SendEvent "{" keyName " down}"
            }
            if !SleepCancelable(10) {
                completed := false
                break
            }
        }
        ReleaseTargetKeys(targetKeys)
    }

    ; Optional nach der Ausfuehrungsdauer noch genau einmal tippen.
    if (completed && !CancelRequested() && actionMode != "block" && tapAfter) {
        if SleepCancelable(30)
            TapTargetKeys(targetKeys, 50)
    }

    Log(
        (CancelRequested() ? "CANCELLED" : "OK") " | keys=" rawKeyText
        " | holdMs=" holdMs
        " | actionMode=" actionMode
        " | repeatIntervalMs=" repeatIntervalMs
        " | tapAfter=" tapAfter
        " | blockPhysical=" blockPhysical
        " | blockedSingle=" accidentalCount
    )
}
finally {
    ; Auch bei einem Fehler darf keine Taste haengen bleiben.
    ReleaseTargetKeys(targetKeys)
    ; Einzel-Hotkeys deaktivieren
    for _, hotkeyName in activeSingleHotkeys {
        Hotkey(hotkeyName, "Off")
    }
    for _, entry in activeComboHotkeys {
        HotIf(entry[1])
        Hotkey(entry[2], "Off")
    }
    HotIf()
    if (cancelFlagPath != "" && FileExist(cancelFlagPath)) {
        try FileDelete cancelFlagPath
    }
    ExitApp
}
