-- Create reviews table for The Picnic Story customer reviews
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT NOT NULL,
  occasion VARCHAR(50),
  is_approved BOOLEAN DEFAULT NULL,  -- NULL = pending, true = approved, false = rejected
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_reviews_approved ON reviews(is_approved);
CREATE INDEX idx_reviews_created_at ON reviews(created_at DESC);

-- Enable Row Level Security
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert reviews (for submission page)
CREATE POLICY "Anyone can submit reviews" ON reviews
  FOR INSERT
  WITH CHECK (true);

-- Policy: Anyone can read approved reviews (for home page)
CREATE POLICY "Anyone can read approved reviews" ON reviews
  FOR SELECT
  USING (is_approved = true);

-- Policy: Authenticated users (admin) can read all reviews
CREATE POLICY "Admins can read all reviews" ON reviews
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Authenticated users (admin) can update reviews
CREATE POLICY "Admins can update reviews" ON reviews
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Policy: Authenticated users (admin) can delete reviews
CREATE POLICY "Admins can delete reviews" ON reviews
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Insert some sample reviews (optional - remove if not needed)
-- INSERT INTO reviews (customer_name, rating, review_text, occasion, is_approved, created_at) VALUES
-- ('Priya Sharma', 5, 'Absolutely magical experience! The setup was gorgeous and the food was delicious. Perfect for our anniversary!', 'Anniversary', true, NOW() - INTERVAL '5 days'),
-- ('Rahul Verma', 5, 'Best birthday surprise ever! My girlfriend loved it. The team went above and beyond to make it special.', 'Birthday', true, NOW() - INTERVAL '3 days'),
-- ('Ananya Patel', 4, 'Beautiful ambiance and great service. The picnic setup exceeded our expectations!', 'Date Night', true, NOW() - INTERVAL '1 day');
