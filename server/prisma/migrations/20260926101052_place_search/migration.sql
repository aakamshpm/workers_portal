-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locationName" TEXT;

-- CreateTable
CREATE TABLE "Town" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Town_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Town_name_key" ON "Town"("name");

-- The fallback for place search (ADR-0010): the town that gives each of the
-- 14 districts its name. Coordinates were checked against Photon on
-- 2026-09-26. Kochi stands for Ernakulam district, because that is the name a
-- worker will type. The migration writes these rows, not the seed, so the
-- fallback exists in every database, including the test database.
INSERT INTO "Town" ("id", "name", "area", "latitude", "longitude") VALUES
  ('thiruvananthapuram', 'Thiruvananthapuram', 'Thiruvananthapuram', 8.4882, 76.9476),
  ('kollam',             'Kollam',             'Kollam',              8.8871, 76.5907),
  ('pathanamthitta',     'Pathanamthitta',     'Pathanamthitta',      9.2655, 76.7872),
  ('alappuzha',          'Alappuzha',          'Alappuzha',           9.5006, 76.3420),
  ('kottayam',           'Kottayam',           'Kottayam',            9.5916, 76.5222),
  ('thodupuzha',         'Thodupuzha',         'Idukki',              9.8977, 76.7134),
  ('kochi',              'Kochi',              'Ernakulam',           9.9679, 76.2444),
  ('thrissur',           'Thrissur',           'Thrissur',           10.5270, 76.2146),
  ('palakkad',           'Palakkad',           'Palakkad',           10.7682, 76.6521),
  ('malappuram',         'Malappuram',         'Malappuram',         11.0429, 76.0808),
  ('kozhikode',          'Kozhikode',          'Kozhikode',          11.2451, 75.7755),
  ('kalpetta',           'Kalpetta',           'Wayanad',            11.6103, 76.0828),
  ('kannur',             'Kannur',             'Kannur',             11.8764, 75.3738),
  ('kasaragod',          'Kasaragod',          'Kasaragod',          12.5036, 74.9907);
