using System;
using System.Globalization;
using System.Threading;

public class CPHInline
{
    public bool Execute()
    {
        CPH.TryGetArg("freakShowRequestAt", out long requestAt);
        CPH.TryGetArg("freakShowRequestTrigger", out string requestTrigger);
        requestTrigger = (requestTrigger ?? "").Trim();

        if (requestAt <= 0L || requestTrigger.Length == 0)
        {
            CPH.LogWarn("FreakShow Resolve Output: Anfrage-Daten fehlen.");
            return false;
        }

        // Der Output Receiver wird vom FreakShow-WebSocket aufgerufen. Kurz warten,
        // bis genau die Ausgabe dieser Ausloesung in Streamer.bot angekommen ist.
        long deadline = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 3500L;
        while (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() <= deadline)
        {
            long outputAt = CPH.GetGlobalVar<long>("freakShow_output_timestamp", false);
            string module = CPH.GetGlobalVar<string>("freakShow_output_module", false) ?? "";
            string outputTrigger = CPH.GetGlobalVar<string>("freakShow_gameControl_trigger", false) ?? "";

            if (outputAt >= requestAt &&
                module.Equals("gameControl", StringComparison.OrdinalIgnoreCase) &&
                outputTrigger.Equals(requestTrigger, StringComparison.OrdinalIgnoreCase))
            {
                string name = CPH.GetGlobalVar<string>("freakShow_gameControl_name", false) ?? "";
                long durationMs = CPH.GetGlobalVar<long>("freakShow_gameControl_durationMs", false);
                durationMs = Math.Max(0L, durationMs);

                double durationSeconds = durationMs / 1000d;
                string formattedTime = CPH.GetGlobalVar<string>("gameControlTime", false) ?? "";
                formattedTime = formattedTime.Trim();
                if (formattedTime.Length == 0)
                {
                    long roundedSeconds = Math.Max(
                        0L,
                        (long)Math.Round(durationSeconds, MidpointRounding.AwayFromZero)
                    );
                    long hours = roundedSeconds / 3600L;
                    long minutes = (roundedSeconds % 3600L) / 60L;
                    long seconds = roundedSeconds % 60L;
                    formattedTime = hours.ToString("00", CultureInfo.InvariantCulture) + ":" +
                        minutes.ToString("00", CultureInfo.InvariantCulture) + ":" +
                        seconds.ToString("00", CultureInfo.InvariantCulture);
                }

                // Weil diese Aktion inline laeuft, stehen die Argumente danach in
                // der urspruenglichen Steuerungsaktion zur Verfuegung.
                CPH.SetArgument("gameControlName", name);
                CPH.SetArgument("gameControlTime", formattedTime);
                CPH.SetArgument("gameControlTimeSeconds", durationSeconds);
                CPH.SetArgument("rawInput", formattedTime + " | " + name);
                return true;
            }

            Thread.Sleep(20);
        }

        CPH.LogWarn("FreakShow Resolve Output: Keine aktuelle Game-Steuerungs-Ausgabe empfangen.");
        return false;
    }
}
