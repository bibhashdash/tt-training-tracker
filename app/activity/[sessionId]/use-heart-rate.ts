"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseHeartRate, type Sample } from "@/lib/hr";

export type LinkStatus = "idle" | "unsupported" | "connecting" | "live" | "reconnecting" | "lost";

const RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

/**
 * Connects to a standard Bluetooth heart rate strap (service 0x180D) via Web
 * Bluetooth, keeps reconnecting if the link drops, and collects readings.
 * `simulate()` produces a fake signal for testing without a strap.
 */
export function useHeartRate() {
  const [status, setStatus] = useState<LinkStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ bpm: number; contact: boolean | null; t: number } | null>(null);
  /** Time of the first reading: the ride clock starts here. */
  const [firstAt, setFirstAt] = useState<number | null>(null);
  const samples = useRef<Sample[]>([]);
  const device = useRef<BluetoothDevice | null>(null);
  const stopped = useRef(false);
  const simTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTarget = useRef(130);

  const record = useCallback((bpm: number, contact: boolean | null) => {
    const t = Date.now();
    if (bpm > 0) samples.current.push({ t, bpm });
    setLatest({ bpm, contact, t });
    setFirstAt((first) => first ?? t);
  }, []);

  const onValue = useCallback(
    (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      const reading = value ? parseHeartRate(value) : null;
      if (reading) record(reading.bpm, reading.contact);
    },
    [record],
  );

  const subscribe = useCallback(
    async (d: BluetoothDevice) => {
      if (!d.gatt) throw new Error("This device has no Bluetooth services.");
      const server = await d.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const characteristic = await service.getCharacteristic("heart_rate_measurement");
      characteristic.addEventListener("characteristicvaluechanged", onValue);
      await characteristic.startNotifications();
      setStatus("live");
      setError(null);
    },
    [onValue],
  );

  const onDisconnected = useCallback(async () => {
    const d = device.current;
    if (stopped.current || !d) return;
    setStatus("reconnecting");
    for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
      if (stopped.current) return;
      try {
        await subscribe(d);
        return;
      } catch {
        // try again
      }
    }
    setStatus("lost");
    setError("Lost the strap. Check it's on and has skin contact, then reconnect.");
  }, [subscribe]);

  /** Opens Chrome's device picker. Must be called from a tap. */
  const connect = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      setStatus("unsupported");
      setError("This browser can't use Bluetooth. Use Chrome on Android.");
      return;
    }
    stopped.current = false;
    setError(null);
    setStatus("connecting");
    try {
      const d = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
      device.current = d;
      setDeviceName(d.name ?? "Heart rate strap");
      d.addEventListener("gattserverdisconnected", onDisconnected);
      await subscribe(d);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotFoundError") {
        // Picker closed without choosing a device.
        setStatus("idle");
        return;
      }
      setStatus("idle");
      setError(
        name === "NetworkError"
          ? "Couldn't connect. Strap busy? Disconnect it from other apps, wet the contacts, and try again."
          : name === "SecurityError" || name === "NotAllowedError"
            ? "Bluetooth permission was refused. Allow it for this site in Chrome's settings."
            : "Couldn't connect to the strap. Try again.",
      );
    }
  }, [onDisconnected, subscribe]);

  /** Reconnects to the strap already chosen, without the picker. */
  const reconnect = useCallback(async () => {
    const d = device.current;
    if (!d) return connect();
    stopped.current = false;
    setStatus("connecting");
    try {
      await subscribe(d);
    } catch {
      setStatus("lost");
      setError("Still can't reach the strap.");
    }
  }, [connect, subscribe]);

  /** Fake heart rate that drifts towards `setSimTarget` with some noise. */
  const simulate = useCallback(() => {
    stopped.current = false;
    setDeviceName("Simulated strap");
    setError(null);
    setStatus("live");
    let bpm = 110;
    simTimer.current = setInterval(() => {
      bpm += (simTarget.current - bpm) * 0.15 + (Math.random() - 0.5) * 4;
      record(Math.round(bpm), true);
    }, 1000);
  }, [record]);

  const setSimTarget = useCallback((bpm: number) => {
    simTarget.current = bpm;
  }, []);

  const disconnect = useCallback(() => {
    stopped.current = true;
    if (simTimer.current) clearInterval(simTimer.current);
    simTimer.current = null;
    device.current?.gatt?.disconnect();
    setStatus("idle");
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return { status, error, deviceName, latest, firstAt, samples, connect, reconnect, simulate, setSimTarget, disconnect };
}

/** Keeps the screen on while `active`, re-acquiring the lock when the page comes back into view. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not allowed (e.g. low battery); the ride still works.
      }
      if (cancelled) await lock?.release();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
