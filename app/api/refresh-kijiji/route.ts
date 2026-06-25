import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export const maxDuration = 300

type Mode = "prune" | "scrape"

interface ProgressEvent {
  step: string
  progress: number
  [key: string]: unknown
}

interface DoneEvent {
  done: true
  ok: boolean
  message: string
  pruned?: number | null
  scraped?: number | null
  bathrooms?: number | null
}

async function runCmd(cmd: string): Promise<string> {
  const { stdout, stderr } = await execAsync(cmd, {
    cwd: process.cwd(),
    timeout: 290_000,
  })
  return stdout + (stderr ? `\nSTDERR: ${stderr}` : "")
}

function parseCount(output: string, pattern: RegExp): number | null {
  const m = output.match(pattern)
  return m ? parseInt(m[1], 10) : null
}

export async function POST(request: Request) {
  let mode: Mode = "prune"
  try {
    const body = await request.json()
    if (body?.mode === "scrape") mode = "scrape"
  } catch {
    // default to prune
  }

  // Verify Python is available
  try {
    await execAsync("python --version", { timeout: 5_000 })
  } catch {
    return new Response(
      JSON.stringify({ done: true, ok: false, message: "Python not found — run locally" }) + "\n",
      { status: 501, headers: { "Content-Type": "application/x-ndjson" } }
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent | DoneEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
      }

      let pruned: number | null = null
      let scraped: number | null = null
      let bathrooms: number | null = null

      // Progress weights per step
      // prune mode:  prune=35, backfill=25, validate=20, filter=20
      // scrape mode: scrape=45, prune=20, backfill=15, validate=10, filter=10

      try {
        if (mode === "scrape") {
          send({ step: "Scraping new listings…", progress: 0 })
          const out = await runCmd("python -m padestrian scrape-listings --pages 5 --append")
          scraped = parseCount(out, /Scraped \+ normalized new listings:\s*(\d+)/)
          send({ step: "Scraping new listings…", progress: 45, scraped })

          send({ step: "Pruning dead listings…", progress: 45 })
          const pruneOut = await runCmd("python -m padestrian prune-kijiji")
          pruned = parseCount(pruneOut, /Deactivated\s+(\d+)/) ?? parseCount(pruneOut, /Removed\s+(\d+)/) ?? parseCount(pruneOut, /(\d+)\s+removed/)
          send({ step: "Pruning dead listings…", progress: 65, pruned })

          send({ step: "Filling bathroom data…", progress: 65 })
          const backfillOut = await runCmd("python -m padestrian backfill-bathrooms --fetch")
          bathrooms = parseCount(backfillOut, /Updated\s+(\d+)/)
          send({ step: "Filling bathroom data…", progress: 80, bathrooms })

          send({ step: "Validating listings…", progress: 80 })
          await runCmd("python -m padestrian validate-listings")
          send({ step: "Validating listings…", progress: 90 })

          send({ step: "Scoring listings…", progress: 90 })
          await runCmd("python -m padestrian filter-listings")
          send({ step: "Scoring listings…", progress: 100 })
        } else {
          send({ step: "Pruning dead listings…", progress: 0 })
          const pruneOut = await runCmd("python -m padestrian prune-kijiji")
          pruned = parseCount(pruneOut, /Deactivated\s+(\d+)/) ?? parseCount(pruneOut, /Removed\s+(\d+)/) ?? parseCount(pruneOut, /(\d+)\s+removed/)
          send({ step: "Pruning dead listings…", progress: 35, pruned })

          send({ step: "Filling bathroom data…", progress: 35 })
          const backfillOut = await runCmd("python -m padestrian backfill-bathrooms --fetch")
          bathrooms = parseCount(backfillOut, /Updated\s+(\d+)/)
          send({ step: "Filling bathroom data…", progress: 60, bathrooms })

          send({ step: "Validating listings…", progress: 60 })
          await runCmd("python -m padestrian validate-listings")
          send({ step: "Validating listings…", progress: 80 })

          send({ step: "Scoring listings…", progress: 80 })
          await runCmd("python -m padestrian filter-listings")
          send({ step: "Scoring listings…", progress: 100 })
        }

        const parts: string[] = []
        if (mode === "scrape") parts.push(`${scraped ?? 0} new`)
        parts.push(`${pruned ?? 0} pruned`)
        if (bathrooms != null && bathrooms > 0) parts.push(`${bathrooms} baths filled`)

        const done: DoneEvent = {
          done: true,
          ok: true,
          message: parts.join(", "),
          pruned,
          scraped,
          bathrooms,
        }
        send(done)
      } catch (err) {
        const done: DoneEvent = {
          done: true,
          ok: false,
          message: err instanceof Error ? err.message.slice(0, 500) : String(err),
        }
        send(done)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  })
}
