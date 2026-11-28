package com.oa.suite.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class ServerStoreNormalizeTest {

    @Test
    public void addsHttpWhenSchemeIsOmitted() {
        assertEquals("http://192.168.124.220:3001", ServerStore.normalize("192.168.124.220:3001"));
        assertEquals("http://192.168.124.220:3001", ServerStore.normalize("  192.168.124.220:3001/  "));
        assertEquals("http://oa.company.com", ServerStore.normalize("oa.company.com"));
        assertEquals("http://localhost:3000", ServerStore.normalize("localhost:3000"));
    }

    @Test
    public void keepsExplicitScheme() {
        assertEquals("http://192.168.1.20:3000", ServerStore.normalize("http://192.168.1.20:3000/"));
        assertEquals("https://oa.example.com", ServerStore.normalize(" HTTPS://OA.Example.com// "));
        assertEquals("https://oa.example.com/oa", ServerStore.normalize("https://oa.example.com/oa/"));
        assertEquals("https://oa.example.com:8443", ServerStore.normalize("https://oa.example.com:8443"));
    }

    @Test
    public void rejectsInvalidInput() {
        assertNull(ServerStore.normalize(null));
        assertNull(ServerStore.normalize("   "));
        assertNull(ServerStore.normalize("ftp://oa.example.com"));
        assertNull(ServerStore.normalize("oa example.com"));
        assertNull(ServerStore.normalize("192.168.1.20:99999"));
        assertNull(ServerStore.normalize("http://user:pw@oa.example.com"));
        assertNull(ServerStore.normalize("http://"));
    }
}
