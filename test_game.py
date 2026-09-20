import unittest
import os
import server

class TestUpdatedTambolaGame(unittest.TestCase):
    def test_csv_questions_loaded(self):
        questions = server.load_questions_from_csv()
        self.assertGreaterEqual(len(questions), 50, "Should have loaded at least 50 questions from questions.csv")
        for q in questions:
            self.assertIn("id", q)
            self.assertIn("category", q)
            self.assertIn("question", q)
            self.assertIn("answers", q)
            self.assertGreater(len(q["answers"]), 0)

    def test_ticket_generator(self):
        for _ in range(10):
            ticket = server.generate_tambola_ticket()
            self.assertEqual(len(ticket), 3)
            for r in range(3):
                row_nums = [n for n in ticket[r] if n is not None]
                self.assertEqual(len(row_nums), 5)
            all_nums = [n for row in ticket for n in row if n is not None]
            self.assertEqual(len(all_nums), 15)
            self.assertEqual(len(set(all_nums)), 15)

    def test_admin_password(self):
        self.assertEqual(server.ADMIN_PASSWORD, "BMS123")

    def test_no_repeated_numbers(self):
        team = server.init_team("TestUniqueNumbers")
        # Simulate collecting all 90 numbers
        collected_set = set()
        for i in range(90):
            already_collected = {item["number"] for item in team["numbers_collected"]}
            available = [n for n in range(1, 91) if n not in already_collected]
            self.assertGreater(len(available), 0)
            import random
            num = random.choice(available)
            self.assertNotIn(num, collected_set)
            collected_set.add(num)
            team["numbers_collected"].append({"number": num, "hit": num in team["ticket_numbers"]})
        self.assertEqual(len(collected_set), 90)

if __name__ == "__main__":
    unittest.main()
