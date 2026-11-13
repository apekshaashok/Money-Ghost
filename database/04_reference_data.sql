-- =====================================================================
--  Money Ghosts - reference data: categories + labelled example merchants
--  scripts/setup-db.mjs embeds every example_text into category_examples.embedding.
--  Example names are deliberately generic: the demo merchants are matched by meaning,
--  not by exact text (e.g. "golds gym" -> nearest example "anytime fitness gym").
-- =====================================================================
INSERT INTO categories (name, description, is_essential) VALUES
 ('Entertainment',     'Streaming, music, movies and audiobooks', false),
 ('Food & Dining',     'Food delivery, restaurants, cafes',        false),
 ('Groceries',         'Groceries and daily household supplies',   true),
 ('Transport',         'Cabs, fuel, metro, trains and flights',    true),
 ('Health & Fitness',  'Gym, fitness, pharmacy and doctors',       false),
 ('Shopping',          'Online and retail shopping',               false),
 ('Utilities & Bills', 'Electricity, water, gas, internet and mobile', true),
 ('Software & Cloud',  'Apps, AI tools and cloud storage',         false),
 ('Housing',           'Rent and maintenance',                     true),
 ('Education',         'Courses, fees and books',                  true),
 ('News & Reading',    'Newspapers, magazines and e-books',        false),
 ('Other',             'Anything that does not match a category',  false);

INSERT INTO category_examples (category_id, example_text)
SELECT c.category_id, x.example
FROM (VALUES
  ('Entertainment', 'netflix'), ('Entertainment', 'spotify music'), ('Entertainment', 'disney plus hotstar'),
  ('Entertainment', 'prime video'), ('Entertainment', 'youtube premium'), ('Entertainment', 'audible audiobooks'),
  ('Entertainment', 'bookmyshow movie tickets'), ('Entertainment', 'sony liv'), ('Entertainment', 'jiocinema'),
  ('Entertainment', 'zee5'), ('Entertainment', 'pvr cinemas'), ('Entertainment', 'apple music'),
  ('Entertainment', 'amazon prime membership'),
  ('Food & Dining', 'swiggy food delivery'), ('Food & Dining', 'zomato'), ('Food & Dining', 'coffee shop'),
  ('Food & Dining', 'starbucks'), ('Food & Dining', 'tea stall'), ('Food & Dining', 'restaurant'),
  ('Food & Dining', 'dominos pizza'), ('Food & Dining', 'mcdonalds'), ('Food & Dining', 'cafe'),
  ('Food & Dining', 'bakery'), ('Food & Dining', 'eatsure'),
  ('Groceries', 'bigbasket groceries'), ('Groceries', 'blinkit'), ('Groceries', 'zepto'),
  ('Groceries', 'dmart supermarket'), ('Groceries', 'milk delivery'), ('Groceries', 'vegetables'),
  ('Groceries', 'reliance fresh'), ('Groceries', 'jiomart'),
  ('Transport', 'uber ride'), ('Transport', 'ola cabs'), ('Transport', 'rapido'),
  ('Transport', 'petrol pump fuel'), ('Transport', 'indian oil'), ('Transport', 'metro card recharge'),
  ('Transport', 'irctc train ticket'), ('Transport', 'makemytrip flight'), ('Transport', 'indigo airlines'),
  ('Transport', 'fastag toll'), ('Transport', 'redbus'),
  ('Health & Fitness', 'cult fit'), ('Health & Fitness', 'anytime fitness gym'), ('Health & Fitness', 'yoga classes'),
  ('Health & Fitness', 'apollo pharmacy'), ('Health & Fitness', 'hospital'), ('Health & Fitness', 'medplus'),
  ('Health & Fitness', 'practo doctor'),
  ('Shopping', 'amazon order'), ('Shopping', 'flipkart'), ('Shopping', 'myntra fashion'), ('Shopping', 'ajio'),
  ('Shopping', 'nykaa'), ('Shopping', 'croma electronics'), ('Shopping', 'ikea'), ('Shopping', 'decathlon'),
  ('Utilities & Bills', 'electricity bill'), ('Utilities & Bills', 'airtel recharge'), ('Utilities & Bills', 'jio recharge'),
  ('Utilities & Bills', 'act fibernet broadband'), ('Utilities & Bills', 'water bill'), ('Utilities & Bills', 'gas cylinder'),
  ('Utilities & Bills', 'tata play dth'),
  ('Software & Cloud', 'icloud storage'), ('Software & Cloud', 'google one storage'), ('Software & Cloud', 'chatgpt plus'),
  ('Software & Cloud', 'notion'), ('Software & Cloud', 'microsoft 365'), ('Software & Cloud', 'adobe creative cloud'),
  ('Software & Cloud', 'dropbox'), ('Software & Cloud', 'github'), ('Software & Cloud', 'canva pro'),
  ('Software & Cloud', 'linkedin premium'),
  ('Housing', 'rent payment'), ('Housing', 'landlord'), ('Housing', 'society maintenance'), ('Housing', 'nobroker'),
  ('Education', 'coursera'), ('Education', 'udemy course'), ('Education', 'college fees'), ('Education', 'unacademy'),
  ('Education', 'bookstore'), ('Education', 'exam fee'),
  ('News & Reading', 'the hindu newspaper'), ('News & Reading', 'times of india'), ('News & Reading', 'kindle unlimited'),
  ('News & Reading', 'magazine subscription'), ('News & Reading', 'economic times')
) AS x(category, example)
JOIN categories c ON c.name = x.category;
