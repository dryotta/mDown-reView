class Calculator:
    def __init__(self):
        self.history = []

    def add(self, a, b):
        result = a + b
        self.history.append(result)
        return result

    def clear(self):
        self.history = []

def main():
    calc = Calculator()
    print(calc.add(1, 2))

if __name__ == "__main__":
    main()
