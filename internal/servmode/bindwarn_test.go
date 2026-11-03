package servmode

import "testing"

func TestIsLoopbackHost(t *testing.T) {
	loopback := []string{
		"", "127.0.0.1", "127.0.0.2", "127.255.255.255", "::1", "0:0:0:0:0:0:0:1",
		"[::1]", "localhost", "LOCALhost", " 127.0.0.1 ", "::ffff:127.0.0.1",
	}
	for _, h := range loopback {
		if !IsLoopbackHost(h) {
			t.Errorf("IsLoopbackHost(%q) = false, want true", h)
		}
	}

	public := []string{
		"0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "example.com", "[::]",
		"172.16.0.5", "8.8.8.8",
	}
	for _, h := range public {
		if IsLoopbackHost(h) {
			t.Errorf("IsLoopbackHost(%q) = true, want false", h)
		}
	}
}
