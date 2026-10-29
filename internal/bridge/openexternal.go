package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// maxExternalURLLength keeps clipboard/URL-bar abuse out of the shell opener.
const maxExternalURLLength = 2048

// ValidateExternalURL accepts only plain http(s) URLs with no embedded credentials.
func ValidateExternalURL(raw string) error {
	if raw == "" {
		return errors.New("empty url")
	}
	if len(raw) > maxExternalURLLength {
		return fmt.Errorf("url too long: %d", len(raw))
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("scheme not allowed: %s", parsed.Scheme)
	}
	if parsed.User != nil {
		return errors.New("credentials in url not allowed")
	}
	if parsed.Host == "" {
		return errors.New("missing host")
	}
	if strings.ContainsAny(raw, "\r\n\t") {
		return errors.New("control characters not allowed")
	}
	return nil
}

// RegisterOpenExternal wires the shell:open-external channel.
func RegisterOpenExternal(r *Router, opener func(string) error) {
	r.Handle(ChannelOpenExternal, func(_ context.Context, args []json.RawMessage) (any, error) {
		raw, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if err := ValidateExternalURL(raw); err != nil {
			return nil, err
		}
		return nil, opener(raw)
	})
}
