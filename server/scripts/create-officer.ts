import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { normalisePhone } from "../src/lib/auth";

/**
 * Create the first labour officer. ADR-0014.
 *
 *   npm --prefix server run create-officer -- --name "Anita Joseph" --phone 9000020001
 *
 * Officers create every other contractor and officer account in the officer
 * app. The very first one has nobody to create it, so it is made here.
 *
 * The account has no PIN. Its owner sets one on the sign-in page with
 * "Forgot PIN", using a code sent to this phone, so the person running this
 * command never learns the PIN.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const name = arg("name")?.trim();
  const phone = normalisePhone(arg("phone") ?? "");

  if (!name || name.length < 2) throw new Error('Give a name: --name "Anita Joseph"');
  if (phone.length !== 10) throw new Error("Give a 10-digit phone number: --phone 9000020001");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    if (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) {
      throw new Error(`${phone} already has an account. Nothing was changed.`);
    }
    await prisma.user.create({
      data: { role: "AUTHORITY", name, phone, homeState: "Kerala", language: "ml", pin: null },
    });
    console.log(`Created labour officer ${name}, ${phone}.`);
    console.log('Next: open the sign-in page, choose "Forgot PIN", and set a PIN with the code sent to that phone.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
