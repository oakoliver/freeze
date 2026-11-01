package main

import (
	"fmt"
	"math/big"
)

// fib returns the nth Fibonacci number.
func fib(n int) *big.Int {
	a, b := big.NewInt(0), big.NewInt(1)
	for i := 0; i < n; i++ {
		a.Add(a, b)
		a, b = b, a
	}
	return a
}

func main() {
	for _, n := range []int{10, 50, 100} {
		fmt.Printf("fib(%d) = %s\n", n, fib(n))
	}
}
