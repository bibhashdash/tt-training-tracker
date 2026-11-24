"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cadenceFromCrank,
  parseCyclingPower,
  parseIndoorBikeData,
  parseTacxFec,
  TACX_FEC_RX,
  TACX_FEC_SERVICE,
  type CrankData,
  type PowerSample,
  type TrainerReading,
} from "@/lib/power";
import type { LinkStatus } from "./use-heart-rate";

export type TrainerProtocol = "Fitness Machine" | "Cycling Power" | "Tacx FE-C" | "Simulated";

const RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
/** No new pedal stroke for this long means you've stopped pedalling. */
const CADENCE_STALE_MS = 3000;

/**
 * Reads power, cadence and speed from a smart trainer over Web Bluetooth.
 * Read-only: nothing is ever written to the trainer, so resistance is untouched.
 * Tries Fitness Machine (0x1826), then Cycling Power (0x1818), then Tacx's own FE-C service.
 */
export function useTrainer() {
  const [status, setStatus] = useState<LinkStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<TrainerProtocol | null>(null);
  const [latest, setLatest] = useState<(TrainerReading & { t: number }) | null>(null);
  const [firstAt, setFirstAt] = useState<number | null>(null);
  const samples = useRef<PowerSample[]>([]);
  const device = useRef<BluetoothDevice | null>(null);
  const stopped = useRef(false);
  const simTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTarget = useRef(110);
  // FE-C sends power and speed on different pages, and Cycling Power sends cadence
  // as crank counts, so keep the last known values and merge each update into them.
  const current = useRef<TrainerReading>({ power: null, cadence: null, speed: null });
  const lastCrank = useRef<CrankData | null>(null);
  const lastStrokeAt = useRef(0);

  const emit = useCallback((update: Partial<TrainerReading>) => {
    const t = Date.now();
    const next = { ...current.current };
    for (const [k, v] of Object.entries(update) as [keyof TrainerReading, number | null][]) {
      if (v !== null && v !== undefined) next[k] = v;
    }
    current.current = next;
    if (update.power !== null && update.power !== undefined) {
      samples.current.push({ t, power: Math.max(0, update.power), cadence: next.cadence });
      setFirstAt((first) => first ?? t);
    }
    setLatest({ ...next, t });
  }, []);

  const subscribe = useCallback(
    async (d: BluetoothDevice) => {
      if (!d.gatt) throw new Error("This device has no Bluetooth services.");
      const server = await d.gatt.connect();

      const attempts: [TrainerProtocol, () => Promise<BluetoothRemoteGATTCharacteristic>, (v: DataView) => void][] = [
        [
          "Fitness Machine",
          async () => (await server.getPrimaryService("fitness_machine")).getCharacteristic("indoor_bike_data"),
          (v) => {
            const r = parseIndoorBikeData(v);
            if (r) emit(r);
          },
        ],
        [
          "Cycling Power",
          async () => (await server.getPrimaryService("cycling_power")).getCharacteristic("cycling_power_measurement"),
          (v) => {
            const r = parseCyclingPower(v);
            if (!r) return;
            let cadence: number | null = null;
            if (r.crank) {
              const rpm = lastCrank.current ? cadenceFromCrank(lastCrank.current, r.crank) : null;
              if (rpm !== null) lastStrokeAt.current = Date.now();
              lastCrank.current = r.crank;
              cadence = rpm;
            }
            if (cadence === null && Date.now() - lastStrokeAt.current > CADENCE_STALE_MS) cadence = 0;
            emit({ power: r.power, cadence });
          },
        ],
        [
          "Tacx FE-C",
          async () => (await server.getPrimaryService(TACX_FEC_SERVICE)).getCharacteristic(TACX_FEC_RX),
          (v) => {
            const r = parseTacxFec(v);
            if (r) emit(r);
          },
        ],
      ];

      for (const [name, find, onData] of attempts) {
        let characteristic: BluetoothRemoteGATTCharacteristic;
        try {
          characteristic = await find();
        } catch {
          continue; // the trainer doesn't offer this one
        }
        characteristic.addEventListener("characteristicvaluechanged", (e) => {
          const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
          if (value) onData(value);
        });
        await characteristic.startNotifications();
        setProtocol(name);
        setStatus("live");
        setError(null);
        return;
      }
      throw new Error("no-supported-service");
    },
    [emit],
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
    setError("Lost the trainer. Check it's powered and nothing else is connected to it, then reconnect.");
  }, [subscribe]);

  /** Opens Chrome's device picker. Must be called from a tap. */
  const connect = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      setStatus("unsupported");
      setError("This browser can't use Bluetooth. Use Chrome on Android or a computer.");
      return;
    }
    stopped.current = false;
    setError(null);
    setStatus("connecting");
    try {
      const services = ["fitness_machine", "cycling_power", TACX_FEC_SERVICE];
      const d = await navigator.bluetooth.requestDevice({
        filters: [...services.map((s) => ({ services: [s] })), { namePrefix: "Tacx" }],
        optionalServices: services,
      });
      device.current = d;
      setDeviceName(d.name ?? "Smart trainer");
      d.addEventListener("gattserverdisconnected", onDisconnected);
      await subscribe(d);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setStatus("idle");
      if (name === "NotFoundError") return; // picker closed
      setError(
        e instanceof Error && e.message === "no-supported-service"
          ? "Connected, but this trainer doesn't share power in a format the app can read."
          : name === "NetworkError"
            ? "Couldn't connect. Close the Tacx app or Zwift (they may be holding the Bluetooth link) and try again."
            : name === "SecurityError" || name === "NotAllowedError"
              ? "Bluetooth permission was refused. Allow it for this site in Chrome's settings."
              : "Couldn't connect to the trainer. Try again.",
      );
    }
  }, [onDisconnected, subscribe]);

  const reconnect = useCallback(async () => {
    const d = device.current;
    if (!d) return connect();
    stopped.current = false;
    setStatus("connecting");
    try {
      await subscribe(d);
    } catch {
      setStatus("lost");
      setError("Still can't reach the trainer.");
    }
  }, [connect, subscribe]);

  /** Fake power drifting towards `setSimTarget`, with cadence around 85-95 rpm. */
  const simulate = useCallback(() => {
    stopped.current = false;
    setDeviceName("Simulated trainer");
    setProtocol("Simulated");
    setError(null);
    setStatus("live");
    let watts = 80;
    simTimer.current = setInterval(() => {
      watts += (simTarget.current - watts) * 0.2 + (Math.random() - 0.5) * 12;
      const power = Math.max(0, Math.round(watts));
      emit({ power, cadence: Math.round(88 + (Math.random() - 0.5) * 8), speed: Math.round(power ** 0.5 * 2.6 * 10) / 10 });
    }, 1000);
  }, [emit]);

  const setSimTarget = useCallback((watts: number) => {
    simTarget.current = watts;
  }, []);

  const disconnect = useCallback(() => {
    stopped.current = true;
    if (simTimer.current) clearInterval(simTimer.current);
    simTimer.current = null;
    device.current?.gatt?.disconnect();
    setStatus("idle");
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    status,
    error,
    deviceName,
    protocol,
    latest,
    firstAt,
    samples,
    connect,
    reconnect,
    simulate,
    setSimTarget,
    disconnect,
  };
}
